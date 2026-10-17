# Agent instructions: what changed (2026-10-16)

`agent-instructions.md` is the revised text for the Sign-up Shield agent in Go. `agent-instructions.original.md` is the text before the change; to revert, paste it back into the agent builder's Instructions box and Save.

Changes
1. "When to act": added a paragraph so isolated text (one sentence in a focused field) that itself contains a listed tactic counts as qualifying. Tested cause: a lone "Only 2 spots left..." got no underline until "free trial" was in the same text.
2. Connector section: replaced the invented operations (GetMerchantRiskHistory, SaveDetectionEvent, GenerateWarningChecklist, GetActiveTrialsAndSubscriptions, SavePurchaseOutcome, ExplainFinding, DeleteHistoryRecord) with the Pack's real ones (ListMerchants, GetMerchantHistory, GetChecklist, GetPendingPageJobs, SubmitPageFindings, MarkPageJobFailed).
3. Saving history is stated to be the extension's job; the agent never saves or deletes.
4. Removed the unused "Detection event contract" and JSON schema sections (the extension, not the agent, builds events).
5. Added instructions for the pending-jobs flow and for merchant questions (answer only from the tool result).
6. Added one example for an isolated urgency sentence.

Note (2026-10-17): the live agent has extra sections added later in the builder (Subscriptions and renewals, Weekly digest, Sensitivity wording patterns, Recurring cost, Cost questions via GetCostSummary). `agent-instructions.md` is the base text; add those sections as you enable the matching Pack tools.
