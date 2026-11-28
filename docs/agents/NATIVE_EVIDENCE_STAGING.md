# Private native evidence staging

This is first-launch verification infrastructure, not a product feature.

A separate private `kc-native-evidence` storage bucket may stage CMS ciphertext up to 25 MiB with `application/octet-stream` MIME type. Ordinary anonymous and authenticated application clients have no access. Its restrictive guard is versioned by the `native_evidence_isolation` migration and tested by pgTAP. An identical existing guard is accepted; unexpected definitions fail closed rather than silently changing them.

The privileged controller issues a unique single-object, no-overwrite signed upload capability lasting two hours. Only the capability reaches the bounded simulator job through a sealed secret. No broad storage credential reaches the runner. The workflow checks that at least 100 minutes remain before a job bounded to 90 minutes. Upload rejects an unexpected destination, object, candidate, expiry or payload size. There is no artifact or public-log fallback.

Before execution, check the current Free plan and quotas. Quota failures stop the work; never upgrade or use paid fallback. After execution the controller downloads ciphertext, verifies integrity and recovery, stores it in owner-only existing cloud storage, and verifies a fresh download/decryption. Only then may that run's staging object and scoped secret be removed.

Rollback: stop dispatch, remove the scoped capability secret, verify durable recovery of any evidence, remove only this new empty bucket through the Storage API, then remove its isolated guard through a reviewed forward migration. Do not delete unrelated buckets, policies or evidence.
