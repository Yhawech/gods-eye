#!/usr/bin/env bash
# GOD EYE - park the whole stack (stop billing while idle)
# Keeps: VPC, subnets, route tables, SGs, IAM, S3 artifacts, CodeDeploy app/DG,
#        launch template, target groups, reserved NAT Elastic IP, alarms (disabled).
# Deletes: NAT Gateway, ALB. Scales ASG to zero (instances + EBS deleted).
set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_REGION="${AWS_REGION:-ap-south-1}"
echo "== GOD EYE PARK ($(date -u +%FT%TZ)) =="

echo "[1/5] Disabling alarm actions..."
for a in gods-eye-alb-target-5xx gods-eye-unhealthy-host gods-eye-response-time gods-eye-asg-inservice gods-eye-ec2-cpu-high gods-eye-ec2-status-check; do
  aws cloudwatch disable-alarm-actions --alarm-names "$a" 2>/dev/null || true
done

echo "[2/5] Scaling ASG to zero (instances terminate, ~2-4 min)..."
aws autoscaling update-auto-scaling-group --auto-scaling-group-name gods-eye-asg --min-size 0 --desired-capacity 0 --max-size 2
for i in $(seq 1 40); do
  N=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names gods-eye-asg --query 'length(AutoScalingGroups[0].Instances)' --output text)
  [ "$N" = "0" ] && break
  sleep 15
done
echo "    instances remaining: ${N:-0}"

echo "[3/5] Deleting ALB..."
ALB_ARN=$(aws elbv2 describe-load-balancers --names gods-eye-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
  aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
  echo "    waiting for ALB deletion..."
  aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB_ARN" 2>/dev/null || sleep 30
else
  echo "    ALB already absent"
fi

echo "[4/5] Deleting NAT Gateway (Elastic IP is KEPT reserved)..."
NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=tag:Name,Values=gods-eye-nat" "Name=state,Values=available,pending" --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null || true)
if [ -n "$NAT_ID" ] && [ "$NAT_ID" != "None" ]; then
  aws ec2 delete-nat-gateway --nat-gateway-id "$NAT_ID"
  echo "    waiting for NAT deletion (~2 min)..."
  aws ec2 wait nat-gateway-deleted --nat-gateway-ids "$NAT_ID" 2>/dev/null || sleep 120
else
  echo "    NAT already absent"
fi
PRV_RT=$(aws ec2 describe-route-tables --filter "Name=tag:Name,Values=gods-eye-private-rt" --query 'RouteTables[0].RouteTableId' --output text)
ROUTE_NAT=$(aws ec2 describe-route-tables --route-table-ids "$PRV_RT" --query 'RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`].NatGatewayId' --output text 2>/dev/null || true)
if [ -n "$ROUTE_NAT" ] && [ "$ROUTE_NAT" != "None" ]; then
  aws ec2 delete-route --route-table-id "$PRV_RT" --destination-cidr-block 0.0.0.0/0 || true
fi

echo "[5/5] Done. Parked."
echo "    Still billed: reserved Elastic IP (~\$3.65/mo) + pennies of S3."
echo "    Wake up later with: bash aws-deploy/start-everything.sh"
