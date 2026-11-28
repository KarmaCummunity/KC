# KC API on Google Cloud (Terraform)

The cloud environment of the KC API ([ADR-009](../../docs/architecture/adr/ADR-009-backend-platform.md) phase 2), as one Terraform configuration. It is applied once per environment with that environment's variable file (`envs/<name>.tfvars`) and its own state.

**Status: written and tested against a mocked provider. It has never been applied: there is no cloud project yet.** The first apply is the first real check, and is expected to need small corrections.

## What it creates

| File | What |
|---|---|
| `apis.tf` | Switches on the Google services used below |
| `identity.tf` | Three service accounts (the API, the scheduler, the deploy workflow), each with only what its job needs, and the trust that lets this repository's deploy branch on GitHub act as the deployer. No key file exists for any of them |
| `registry.tf` | The registry of the API's container images; old images are removed, the recent ones are kept for rollback |
| `secrets.tf` | An empty secret for each secret setting of the API. A person adds the values; none is ever in this repository or in the Terraform state |
| `run.tf` | The API as a Cloud Run service that scales to zero, and its plain settings |
| `storage.tf` | KC's three file buckets (ADR-012), closed to the internet |
| `scheduler.tf` | The API's ten scheduled jobs, **paused** until each job's work is switched over from the database's own scheduler |
| `budget.tf` | A monthly budget that emails the billing account's administrators at 50%, 90% and 100%. It only warns |

## What the development environment costs

It is built to have no fixed monthly cost worth naming: the API is billed only while it serves a request, there is no Redis and no cloud database, and the buckets are empty. What remains is storage of the container images, the scheduler jobs beyond the three free ones, and the secrets: an estimate of a few US dollars a month, which the budget alert watches. This is an estimate, not a measurement; the first month's bill is the measurement.

What would add a fixed cost, and is therefore not here: managed Redis (needed with a second API instance), a load balancer with a CDN for the media address, and Cloud SQL (ADR-009 phase 10).

## First-time setup

One time per environment, by a person who owns the Google Cloud project. Google Cloud Shell (the terminal in the Cloud console) has every tool needed.

1. **Create the project** in the Google Cloud console and link a billing account to it.
2. **Open Cloud Shell**, get this repository, and go to this directory:

   ```bash
   gh auth login                       # once; the repository is private
   gh repo clone KarmaCummunity/KC && cd KC/infra/gcp
   ```

3. **Create the bucket that holds Terraform's state** (its record of what it created):

   ```bash
   PROJECT=<the project's id>
   gcloud config set project "$PROJECT"
   gcloud storage buckets create "gs://$PROJECT-tfstate" --location=europe-west3 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update "gs://$PROJECT-tfstate" --versioning
   ```

4. **Apply.** Terraform lists what it will create and asks before it does:

   ```bash
   terraform init -backend-config="bucket=$PROJECT-tfstate" -backend-config="prefix=kc/dev"
   terraform apply -var-file=envs/dev.tfvars -var="project_id=$PROJECT"
   ```

   To also create the budget alert, add the billing account's id and the monthly amount in the account's own currency:

   ```bash
   terraform apply -var-file=envs/dev.tfvars -var="project_id=$PROJECT" \
     -var="billing_account_id=<XXXXXX-XXXXXX-XXXXXX>" -var='monthly_budget={currency_code="ILS",units=100}'
   ```

   After this the service exists and answers with a placeholder page; the API itself arrives with the first deploy.

5. **Add the database connection string** as the value of its secret. Type or paste it into the terminal only, never into a chat, an issue or a file of the repository:

   ```bash
   read -rs VALUE && printf '%s' "$VALUE" | gcloud secrets versions add kc-api-dev-database-url --data-file=- && unset VALUE
   ```

   It is the connection string of the API's own database user, `kc_api`, on the kc-dev Supabase project. A migration creates that user without a password; a person sets one in the Supabase SQL editor (`alter role kc_api password '<a long random value>';`) and uses it here. The API needs a connection that keeps its session (it listens for database events), so the address is the project's *session* pooler (port 5432) with the user written as `kc_api.<project ref>`; this is the expected form and is confirmed at the first deploy.

6. **Tell the agent** the project's id and that step 5 is done. The agent then adds `"DATABASE_URL"` to `mounted_secrets` in `envs/dev.tfvars` in a pull request; after it merges, run the `terraform apply` of step 4 again.
7. **Give the deploy workflow its four settings**, as repository *variables* on GitHub (Settings → Secrets and variables → Actions → Variables). None is a secret; `terraform output` prints the last three:

   | Variable | Value |
   |---|---|
   | `GCP_PROJECT_ID` | the project's id |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | output `workload_identity_provider` |
   | `GCP_DEPLOYER_SERVICE_ACCOUNT` | output `deployer_service_account` |
   | `GCP_IMAGE_REPOSITORY` | output `image_repository` |

## Later changes

- **Another secret** (a provider's key, when its feature is switched on): add its value as in step 5 (the secret's name is in `terraform output secret_names`), then add the variable's name to `mounted_secrets` and apply. A service that references a secret without a value cannot start, which is why the two steps are in this order.
- **Switching a job over**: its schedule is removed from the database's scheduler in a migration and the jobs here are unpaused (`jobs_paused = false`). Both at once would do the work twice.
- **A file store for the API**: set `media_public_url` once KC's media address exists; until then the API is deployed without one and its storage routes answer `503`.
- **A second instance**: needs Redis first. Set `redis_url_secret = true` after the Redis address was added as the value of the `REDIS_URL` secret, and only then raise `max_instances`; the configuration refuses the other order.

## Checking a change

```bash
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
terraform test          # tests/environment.tftest.hcl, against a mocked provider: no account, nothing created
```

The tests assert what this configuration promises: one instance without Redis, jobs paused and addressed to their routes with the identity the API accepts, buckets closed to the internet, credentials only for this repository's deploy branch, and that the unsafe combinations are refused.

## Not here yet

- The deploy stage of the GitHub workflow (build the image, push it, roll out a revision). It is the next step of phase 2 and reads the four variables above.
- The media address: a load balancer and CDN in front of the public buckets, and its DNS records.
- Managed Redis and Cloud SQL, each created by the phase that first needs it.
