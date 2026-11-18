# GOD EYE — AWS Deployment Operations

Production stack for GOD EYE v2 (FastAPI dashboard + 3D globe companion), deployed in **ap-south-1** exactly as presented in the project PPT: VPC with private subnets, NAT Gateway, ALB, Auto Scaling, CodeDeploy CI/CD via GitHub Actions OIDC, Secrets Manager, CloudWatch + SNS.

## Daily operations (the only two commands you need)

| Action | Local terminal | GitHub Actions (phone-friendly) |
|---|---|---|
| **Wake up** (start billing, ~15 min) | `bash aws-deploy/start-everything.sh` | Actions tab → **Wake GOD EYE** → Run workflow |
| **Park** (stop billing, ~3 min) | `bash aws-deploy/stop-everything.sh` | Actions tab → **Park GOD EYE** → Run workflow |

- Waking **reuses the reserved Elastic IP**, so the MongoDB Atlas allow-list never needs updating.
- The ALB DNS name **changes on every wake** — the scripts print the new URLs and auto-update the `GLOBE_VIEW_URL` GitHub variable. Re-bookmark after each wake.
- Waking also **redeploys the latest revision** from S3 automatically, so a parked stack comes back with the app installed.
- Idle cost while parked: **~$3.65/month** (reserved Elastic IP) + pennies of S3.

## Live resources (created 2026-09-29, account 000000000000)

| Resource | Name / ID |
|---|---|
| VPC | `gods-eye-vpc` — vpc-0f15b549e25b04904 (10.0.0.0/16) |
| Public subnets | `gods-eye-public-1` 10.0.1.0/24 (1a), `gods-eye-public-2` 10.0.2.0/24 (1b) |
| Private subnets | `gods-eye-private-1` 10.0.11.0/24 (1a), `gods-eye-private-2` 10.0.12.0/24 (1b) |
| Internet Gateway | `gods-eye-igw` — igw-0df8642365d5913b0 |
| NAT Gateway | `gods-eye-nat` — nat-0bf56fc72446a51ed, **Elastic IP YOUR_EC2_PUBLIC_IP** (eipalloc-0653ffe1373998c4d, reserved) |
| Security groups | `gods-eye-alb-sg` (80/443/8080 world), `gods-eye-app-sg` (4173/4174 from ALB only; no SSH — SSM Session Manager) |
| S3 artifacts | `gods-eye-deploy-artifacts-000000000000` (versioned, encrypted, public-blocked) |
| IAM | `gods-eye-github-actions-role` (OIDC, main branch only), `gods-eye-ec2-role` + profile, `gods-eye-codedeploy-service-role` |
| Launch template | `gods-eye-lt` — Ubuntu 22.04, t3.small, 20 GB gp3, IMDSv2, CodeDeploy agent (latestv2) |
| ASG | `gods-eye-asg` — min 1 / desired 1 / max 2, ELB health checks, target-tracking CPU 60% (`gods-eye-cpu60`) |
| ALB | `gods-eye-alb` — listeners :80 → `gods-eye-tg` (app, health `/api/health`, success 200 only), :8080 → `gods-eye-globe-tg` (globe, health `/`) |
| CodeDeploy | `gods-eye-app` + `gods-eye-dg` (in-place, OneAtATime, tied to ASG) |
| Monitoring | SNS `gods-eye-alerts` (ap-south-1) + 6 alarms (5XX, unhealthy host, response time, ASG capacity, CPU, status checks); SNS `gods-eye-billing` + `gods-eye-billing-guard` alarm >$150 (us-east-1) |

## CI/CD (already wired)

- Push to `main` runs the verify job of **GOD EYE AWS ASG CodeDeploy** (`.github/workflows/deploy-ec2.yml`).
- Manual run with `deploy_to_aws=true` builds the zip → S3 → upserts Secrets Manager `/gods-eye/prod/app-env` → CodeDeploy rollout.
- Deploy **only while the stack is awake** (CodeDeploy needs a live target).
- `wake.yml` / `park.yml` are the wake/park buttons (OIDC, no stored AWS keys anywhere).

## One-time setup checklist (all done 2026-09-29)

- [x] AWS infra, IAM/OIDC, S3, ALB/ASG/CodeDeploy, alarms — done, first deployment verified green
- [x] GitHub variables fixed: `AWS_ROLE_TO_ASSUME`, `S3_DEPLOY_BUCKET`, `GLOBE_ENABLED=true`, `GLOBE_VIEW_URL`
- [x] MongoDB Atlas Network Access locked to NAT Elastic IP `YOUR_EC2_PUBLIC_IP` (`0.0.0.0/0` removed)
- [x] CodeDeploy activated (account payment method) + app deployed: `/api/health` returns `ok:true`, `database.connected:true`
- [ ] You, when the key arrives: refresh DeepSeek → `gh secret set DEEPSEEK_API_KEY` (chat/report endpoints dead until then)
- [ ] Later: domain → ACM cert + HTTPS listener + referrer-lock the Google key (makes PPT slide 18 fully true)

## Hard-won deployment notes (read before debugging)

1. **GitHub OIDC sub format**: the token `sub` is `repo:Yhawech@116061037/GODS_EYE_LATEST@1307794288:ref:refs/heads/main` — GitHub embeds owner/repo **entity IDs**. The IAM trust policy on `gods-eye-github-actions-role` matches exactly this. Find your IDs via `gh api repos/OWNER/REPO --jq '.owner.id, .id'` or CloudTrail `AssumeRoleWithWebIdentity` events.
2. **Python version on EC2**: Ubuntu 22.04 venv is **Python 3.10** — nested same-quote f-strings (legal only in 3.12+) crash the app with `SyntaxError: f-string: unmatched '('` at import. Fixed in `backend/main.py` (airplanes_live_to_aircraft); avoid reintroducing them. The workflow's verify job runs Python 3.12 and will NOT catch this.
3. **Globe target group**: the ASG must be attached to BOTH `gods-eye-tg` and `gods-eye-globe-tg` (`aws autoscaling attach-load-balancer-target-groups`), or the globe returns 503 through the ALB even while the service runs on 4174.
4. **Launch template user-data (v3)**: Ubuntu 22.04 ships the SSM agent via snap; `dpkg -i amazon-ssm-agent.deb` aborts user-data when snap already provides it. v3 skips the deb install when snap has it — keep this guard.
5. **Health-check churn**: while no app is deployed on a fresh instance, ELB health checks fail and the ASG replaces instances in a loop (credit burn). The park/wake scripts handle this; if debugging manually, set `--health-check-type EC2` first, restore `ELB` after.

## Monthly cost (ap-south-1, on-demand)

| Item | Running | Parked |
|---|---|---|
| t3.small ×1 (scales to 2 under CPU>60%) | $15.20 | $0 |
| NAT Gateway | $34 | $0 (deleted) |
| ALB | $21 | $0 (deleted) |
| Elastic IP (reserved) | $3.65 | $3.65 |
| EBS 20 GB gp3 | $1.95 | $0 |
| Alarms/SNS/S3 | ~$1 | ~$0.05 |
| **Total** | **~$77/mo** | **~$3.65/mo** |

Credits: $200 (account created 2026-09-04, free plan — card never charged; account just closes when credits/window end ~2027-03-04).

## Troubleshooting

- **Health shows `database.connected: false`** → Atlas Network Access is missing `YOUR_EC2_PUBLIC_IP`.
- **Globe blank/black** → Google Cloud: billing active + Map Tiles API + Maps JavaScript API enabled for the key's project.
- **Wake says "no prior revision in S3"** → run the deploy workflow once first (while awake).
- **SSH** → don't; use AWS Console → Session Manager (SSM) on instance `gods-eye-app`.
- **Rollback** → `aws deploy list-deployment-configs` n/a; redeploy previous S3 revision key (`gods-eye/<old-sha>/gods-eye-codedeploy.zip`).
