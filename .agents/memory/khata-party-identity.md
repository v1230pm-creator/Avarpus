---
name: Khata overview party identity
description: Which rows on the Shop Khata overview are the same person, how they merge, and what is deliberately not merged.
---

**Rule:** A person is one Khata row when the data proves it: a dealer-posted repair whose `customerId` points to a customer record on the device is shown inside that customer's row (subtitle "Dealer", counted in the Dealers filter). The row's balance stays the server's `customer.dueAmount` (it already contains those repairs), and the row still opens the server-backed customer khata page, which lists every delivered repair by customer id. Only dealer entries whose repair has no known customer link get a dealer row of their own (name-consolidated, ids merged into the detail URL). Dealer entries are never merged into customers by name or by mobile number.

**Why:** the owner saw "Ritesh patel" and "Awdhesh bhaiya" twice (customer row + dealer row for the same repairs) and "To receive" double-counted them; in production every dealer-linked repair carried the customer id, so linking is the safe identity. Same-name customers are separate accounts by an earlier decision (test: "keeps different customers separate even when their names match"), and the customer detail takes exactly one customer id, so mobile-number merging would show a balance the page cannot explain.

**How to apply:** party grouping must sum `debit - credit` per entry (not read the running `partyBalance`) so it stays correct on a subset; "To receive" = Σ customer dues + Σ unlinked dealer party balances + shop-to-shop receivable, each once. A legacy dealer repair with no customer id still yields a separate settled/due dealer row — merging it would need the customer detail to render client-side dealer entries too. Known pre-existing gaps: roles without the Customers feature see no customer rows (customers list is not loaded), and a customer's activity date ignores manual khata transactions.
