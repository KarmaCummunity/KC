// Exact reviewed monitor shape. One SHA input, no code or argv inputs.
export const DRYRUN_WORKFLOW = {
  "name": "PROD migration dry-run only",
  "on": {
    "workflow_dispatch": {
      "inputs": {
        "candidate": {
          "description": "Exact qualified current DEV SHA, database inputs must match reviewed plan",
          "required": true,
          "type": "string"
        }
      }
    }
  },
  "permissions": {
    "contents": "read"
  },
  "jobs": {
    "dryrun": {
      "if": "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
      "permissions": {
        "contents": "read"
      },
      "strategy": {
        "matrix": {
          "target": [
            {
              "environment": "supabase-prod"
            }
          ]
        }
      },
      "environment": "${{ matrix.target.environment }}",
      "concurrency": {
        "group": "prod-migration-readonly-plan",
        "cancel-in-progress": false
      },
      "steps": [
        {
          "uses": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "with": {
            "ref": "${{ github.workflow_sha }}",
            "fetch-depth": 0,
            "persist-credentials": false
          }
        },
        {
          "uses": "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
          "with": {
            "node-version-file": ".nvmrc"
          }
        },
        {
          "uses": "./.github/actions/setup-supabase-cli"
        },
        {
          "name": "Fixed-argv supabase db push --dry-run only, never apply",
          "env": {
            "GITHUB_TOKEN": "${{ github.token }}",
            "SUPABASE_ACCESS_TOKEN": "${{ secrets.SUPABASE_ACCESS_TOKEN }}",
            "SUPABASE_DB_PASSWORD": "${{ secrets.SUPABASE_DB_PASSWORD }}",
            "SUPABASE_PROJECT_REF": "${{ secrets.SUPABASE_PROJECT_REF }}",
            "KC_PROD_SCHEMA_MODE": "${{ vars.KC_PROD_SCHEMA_MODE }}",
            "QUALIFIED_CANDIDATE": "${{ inputs.candidate }}"
          },
          "run": "node scripts/release/prod-dryrun-only.mjs"
        }
      ]
    }
  }
};
