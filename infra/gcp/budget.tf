# A budget that warns before the month's spending passes the agreed amount
# (ADR-009, "Cost"). It only notifies: nothing is switched off by it.

resource "google_billing_budget" "monthly" {
  count = var.billing_account_id == null ? 0 : 1

  billing_account = var.billing_account_id
  display_name    = "KC ${var.environment}: monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.monthly_budget.currency_code
      units         = tostring(var.monthly_budget.units)
    }
  }

  # The billing account's administrators are emailed at each of these.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.enabled]
}
