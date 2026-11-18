#!/usr/bin/env bash
# GOD EYE - wake the whole stack up (NAT + ALB + instance + app deploy)
# Reuses the reserved NAT Elastic IP so MongoDB Atlas allow-listing stays valid.
# Ends by printing the live dashboard + globe URLs.
set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_REGION="${AWS_REGION:-ap-south-1}"
REGION="$AWS_REGION"
BUCKET="gods-eye-deploy-artifacts-$(aws sts get-caller-identity --query Account --output text)"
echo "== GOD EYE WAKE ($(date -u +%FT%TZ)) =="
ERR_COUNT=0

echo "[1/6] Elastic IP..."
EIP_ALLOC=$(aws ec2 describe-addresses --filter "Name=tag:Name,Values=gods-eye-nat-eip" --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)
if [ -z "$EIP_ALLOC" ] || [ "$EIP_ALLOC" = "None" ]; then
  EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=gods-eye-nat-eip},{Key=project,Value=gods-eye}]' --query 'AllocationId' --output text)
  echo "    NEW EIP allocated ($EIP_ALLOC) - add it to MongoDB Atlas Network Access!"
else
  echo "    reserved EIP found ($EIP_ALLOC) - Atlas allow-list stays valid"
fi

echo "[2/6] NAT Gateway..."
NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=tag:Name,Values=gods-eye-nat" "Name=state,Values=available,pending" --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null || true)
if [ -z "$NAT_ID" ] || [ "$NAT_ID" = "None" ]; then
  PUB1=$(aws ec2 describe-subnets --filter "Name=tag:Name,Values=gods-eye-public-1" --query 'Subnets[0].SubnetId' --output text)
  NAT_ID=$(aws ec2 create-nat-gateway --subnet-id "$PUB1" --allocation-id "$EIP_ALLOC" --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=gods-eye-nat},{Key=project,Value=gods-eye}]' --query 'NatGateway.NatGatewayId' --output text)
  echo "    created $NAT_ID - waiting (~2 min)..."
  aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"
else
  echo "    NAT exists ($NAT_ID)"
fi

echo "[3/6] Private route to NAT..."
PRV_RT=$(aws ec2 describe-route-tables --filter "Name=tag:Name,Values=gods-eye-private-rt" --query 'RouteTables[0].RouteTableId' --output text)
EXISTING_NAT=$(aws ec2 describe-route-tables --route-table-ids "$PRV_RT" --query 'RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`].NatGatewayId' --output text 2>/dev/null || true)
if [ "$EXISTING_NAT" = "$NAT_ID" ]; then
  echo "    route already correct"
elif [ -n "$EXISTING_NAT" ] && [ "$EXISTING_NAT" != "None" ]; then
  aws ec2 replace-route --route-table-id "$PRV_RT" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_ID"
else
  aws ec2 create-route --route-table-id "$PRV_RT" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_ID" >/dev/null
fi

echo "[4/6] ALB + listeners..."
ALB_ARN=$(aws elbv2 describe-load-balancers --names gods-eye-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  PUB_SUBNETS=$(aws ec2 describe-subnets --filter "Name=tag:Name,Values=gods-eye-public-*" --query 'Subnets[].SubnetId' --output json | tr -d '\n ')
  ALB_SG=$(aws ec2 describe-security-groups --filter "Name=tag:Name,Values=gods-eye-alb-sg" --query 'SecurityGroups[0].GroupId' --output text)
  VPC_ID=$(aws ec2 describe-security-groups --group-ids "$ALB_SG" --query 'SecurityGroups[0].VpcId' --output text)
  ALB_ARN=$(aws elbv2 create-load-balancer --name gods-eye-alb --type application --scheme internet-facing --subnets $PUB_SUBNETS --security-groups "$ALB_SG" --tags Key=project,Value=gods-eye --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  echo "    created ALB - waiting for it to be active..."
  aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN" 2>/dev/null || sleep 60
else
  echo "    ALB exists"
fi
APP_TG=$(aws elbv2 describe-target-groups --names gods-eye-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ -z "$APP_TG" ] || [ "$APP_TG" = "None" ]; then
  APP_TG=$(aws elbv2 create-target-group --name gods-eye-tg --protocol HTTP --port 4173 --vpc-id "$VPC_ID" --target-type instance --health-check-protocol HTTP --health-check-path /api/health --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --matcher HttpCode=200 --tags Key=project,Value=gods-eye --query 'TargetGroups[0].TargetGroupArn' --output text)
fi
GLOBE_TG=$(aws elbv2 describe-target-groups --names gods-eye-globe-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ -z "$GLOBE_TG" ] || [ "$GLOBE_TG" = "None" ]; then
  GLOBE_TG=$(aws elbv2 create-target-group --name gods-eye-globe-tg --protocol HTTP --port 4174 --vpc-id "$VPC_ID" --target-type instance --health-check-protocol HTTP --health-check-path / --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --matcher HttpCode=200 --tags Key=project,Value=gods-eye --query 'TargetGroups[0].TargetGroupArn' --output text)
fi
L80=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`80`].ListenerArn' --output text 2>/dev/null || true)
if [ -z "$L80" ] || [ "$L80" = "None" ]; then
  aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 --default-actions Type=redirect,RedirectConfig='{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' >/dev/null
fi
L8080=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`8080`].ListenerArn' --output text 2>/dev/null || true)
[ -z "$L8080" ] || [ "$L8080" = "None" ] && aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 8080 --default-actions Type=forward,TargetGroupArn="$GLOBE_TG" >/dev/null
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)
CERT_ARN="${ACM_CERT_ARN:-arn:aws:acm:ap-south-1:000000000000:certificate/3068a242-5736-4cc4-93ac-8ee7183645a1}"
CERT_STATE=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.Status' --output text 2>/dev/null || echo "MISSING")
if [ "$CERT_STATE" = "ISSUED" ]; then
  ALB_SG_ID=$(aws ec2 describe-security-groups --filter "Name=tag:Name,Values=gods-eye-alb-sg" --query 'SecurityGroups[0].GroupId' --output text)
  HAS8443=$(aws ec2 describe-security-group-rules --filter "Name=group-id,Values=$ALB_SG_ID" --query 'length(SecurityGroupRules[?PortRange.From==\`8443\` && IsEgress==\`false\`])' --output text 2>/dev/null || echo 0)
  [ "${HAS8443:-0}" = "0" ] && aws ec2 authorize-security-group-ingress --group-id "$ALB_SG_ID" --protocol tcp --port 8443 --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
  L443=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`443`].ListenerArn' --output text 2>/dev/null || true)
  [ -z "$L443" ] || [ "$L443" = "None" ] && aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTPS --port 443 --certificates CertificateArn="$CERT_ARN" --default-actions Type=forward,TargetGroupArn="$APP_TG" >/dev/null
  L8443=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`8443`].ListenerArn' --output text 2>/dev/null || true)
  [ -z "$L8443" ] || [ "$L8443" = "None" ] && aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTPS --port 8443 --certificates CertificateArn="$CERT_ARN" --default-actions Type=forward,TargetGroupArn="$GLOBE_TG" >/dev/null
  GLOBE_PUBLIC_URL="https://globe.godseyes.in:8443"
else
  echo "    WARNING: ACM cert not ISSUED (state=$CERT_STATE) - HTTP-only this wake"
  GLOBE_PUBLIC_URL="http://$ALB_DNS:8080"
  ERR_COUNT=$((ERR_COUNT+1))
fi

echo "    refreshing Route 53 alias records (domain must follow the new ALB)..."
ALB_ZONE=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)
R53_ZONE=$(aws route53 list-hosted-zones-by-name --dns-name godseyes.in --query 'HostedZones[0].Id' --output text 2>/dev/null | cut -d/ -f3)
if [ -n "$R53_ZONE" ] && [ "$R53_ZONE" != "None" ]; then
  aws route53 change-resource-record-sets --hosted-zone-id "$R53_ZONE" --change-batch "{\"Changes\":[$(for name in godseyes.in www.godseyes.in globe.godseyes.in; do printf '{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"A","AliasTarget":{"HostedZoneId":"%s","DNSName":"%s","EvaluateTargetHealth":false}}}\n' "$name" "$ALB_ZONE" "$ALB_DNS"; done | paste -sd, -)]}" >/dev/null
  echo "    godseyes.in / www / globe -> $ALB_DNS"
else
  echo "    WARNING: Route 53 zone for godseyes.in not found - update alias records manually!"
fi

echo "[5/6] Scaling ASG up + enabling alarms..."
aws autoscaling update-auto-scaling-group --auto-scaling-group-name gods-eye-asg --min-size 1 --desired-capacity 1 --max-size 2
for a in gods-eye-alb-target-5xx gods-eye-unhealthy-host gods-eye-response-time gods-eye-asg-inservice gods-eye-ec2-cpu-high gods-eye-ec2-status-check; do
  aws cloudwatch enable-alarm-actions --alarm-names "$a" 2>/dev/null || true
done
echo "    instance launching; waiting for a healthy target (up to ~12 min)..."
HEALTHY=0
for i in $(seq 1 48); do
  H=$(aws elbv2 describe-target-health --target-group-arn "$APP_TG" --query 'length(TargetHealthDescriptions[?TargetHealth.State==`healthy`])' --output text 2>/dev/null || echo 0)
  if [ "${H:-0}" != "0" ]; then HEALTHY=1; break; fi
  sleep 15
done
if [ "$HEALTHY" = "1" ]; then echo "    target healthy"; else echo "    WARNING: no healthy target yet - app may still be deploying"; ERR_COUNT=$((ERR_COUNT+1)); fi

echo "[6/6] Redeploying latest app revision..."
LATEST=$(aws deploy list-application-revisions --application-name gods-eye-app --deployed --s3-bucket "$BUCKET" --sort-by RegisterTime --sort-order Descending --query 'revisions[0].location.s3Location.key' --output text 2>/dev/null || true)
if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
  # --deployed comes back empty after a park (no instances) - fall back to newest S3 object
  LATEST=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "gods-eye/" --query 'sort_by(Contents,&LastModified)[-1].Key' --output text 2>/dev/null || true)
  if [ -n "$LATEST" ] && [ "$LATEST" != "None" ]; then echo "    (--deployed list empty; using newest S3 object: $LATEST)"; fi
fi
if [ -n "$LATEST" ] && [ "$LATEST" != "None" ]; then
  DEP_ID=$(aws deploy create-deployment --application-name gods-eye-app --deployment-group-name gods-eye-dg --revision "revisionType=S3,s3Location={bucket=$BUCKET,key=$LATEST,bundleType=zip}" --query 'deploymentId' --output text)
  echo "    CodeDeploy deployment $DEP_ID started - polling status (up to 15 min)..."
  DEP_OK=0; DEP_STATUS=""
  for i in $(seq 1 60); do
    DEP_STATUS=$(aws deploy get-deployment --deployment-id "$DEP_ID" --query 'deploymentInfo.status' --output text 2>/dev/null || echo "")
    case "$DEP_STATUS" in
      Succeeded) DEP_OK=1; break ;;
      Failed|Stopped) break ;;
    esac
    sleep 15
  done
  if [ "$DEP_OK" = "1" ]; then
    echo "    deployment $DEP_ID SUCCEEDED"
  else
    echo "    ERROR: deployment $DEP_ID ended with status=${DEP_STATUS:-UNKNOWN} - inspect: aws deploy get-deployment --deployment-id $DEP_ID"
    ERR_COUNT=$((ERR_COUNT+1))
  fi
else
  echo "    ERROR: no revision found in S3 - trigger the GitHub Actions deploy workflow first"
  ERR_COUNT=$((ERR_COUNT+1))
fi

echo "    refreshing GLOBE_VIEW_URL GitHub variable..."
gh variable set GLOBE_VIEW_URL --body "$GLOBE_PUBLIC_URL" -R Yhawech/GODS_EYE_LATEST 2>/dev/null || { echo "    ERROR: could not update GLOBE_VIEW_URL - set it manually to $GLOBE_PUBLIC_URL"; ERR_COUNT=$((ERR_COUNT+1)); }

echo "    verifying live URLs..."
for u in "https://godseyes.in/api/health" "$GLOBE_PUBLIC_URL"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u" 2>/dev/null || echo 000)
  echo "    HTTP $CODE  $u"
  [ "$CODE" = "200" ] || ERR_COUNT=$((ERR_COUNT+1))
done

echo ""
echo "== GOD EYE IS AWAKE =="
echo "  Dashboard : https://godseyes.in  (alias of $ALB_DNS)"
echo "  Globe     : $GLOBE_PUBLIC_URL"
echo "  Health    : https://godseyes.in/api/health"
if [ "$ERR_COUNT" -gt 0 ]; then
  echo "!! $ERR_COUNT issue(s) detected during wake - see ERROR/WARNING lines above !!"
  exit 1
fi
echo "== all checks passed =="
