---
name: Chat report moderation queue
description: Who may read abuse reports, and how a report's review state is allowed to move.
---

## Reports are platform-operator data, not shop data

A chat abuse report names both the reporter and the accused. Only `super_admin`
may read or decide one. The shop the two users belong to has no claim on it:
the shop owner, shop staff, the reported user, and the reporter themself all get
403, and a refused response must not echo any report content back.

**Why:** the reporter is often reporting someone inside their own shop or
contact list. Any shop-scoped visibility rule would hand the report to a party
with an interest in burying it, and would leak the fact that a report exists.

**How to apply:** new report-adjacent endpoints go behind `requireAuth` +
`requireRole("super_admin")` and never behind shop membership or role features.
Keep the operator surface on its own route module rather than mixing it into the
user-facing chat routes, so the auth posture of the file is unambiguous.

## Review state is one-way and terminal

`open → reviewed | actioned | dismissed`, `reviewed → actioned | dismissed`, and
`actioned` / `dismissed` accept nothing further (409). There is no reopen.

**Why:** this mirrors the public-requests workflow already in the product, and a
moderation decision that can be silently rewritten is not an audit trail. The
same reasoning bans nulling an existing note: omitting a note on a later
decision preserves the earlier one.

**How to apply:** claim the row inside a transaction with `FOR UPDATE` before
checking the transition table, so two operators cannot both move the same
report. Store the deciding operator and the decision time alongside the state —
a state with no author cannot be reviewed later.

## Settling a report notifies the reporter, and nobody else

Reaching a terminal state (`actioned` / `dismissed`) sends one in-app alert to
the reporter. The interim `reviewed` state sends nothing, the accused user is
never told a report exists, and both terminal decisions produce byte-identical
wording carrying no operator note, no outcome word, and no hint of a penalty.

**Why:** the reporter needs to know a human looked, but telling them which
decision landed reveals enforcement against another account, and a distinct
"dismissed" message invites arguing the decision or re-reporting to get a
different one.

**How to apply:** send it fire-and-forget after the decision transaction commits
so a notification failure can never undo the operator's decision, key it by
report id so a retry cannot stack alerts, and keep the alert free of any
navigation target — the report itself remains operator-only data.

## The reporter's own view is two words wide

The person who filed a report may read their own reports back — the room, their
own reason and note, the time they filed — and exactly one progress flag:
reviewers are still looking, or they have finished. Both terminal decisions
collapse into "finished"; the interim `reviewed` state still reads as waiting,
so it matches what the settlement alert says.

**Why:** without a durable list, a cleared notification erases the only trace a
report ever existed, and people re-report the same account. But the moment this
list carries the reviewer, the note, the raw status word, or anything about the
accused, it has become a second read path into the operator queue that the
403-for-everyone rule above exists to prevent.

**How to apply:** keep the reporter-scoped read in the user-facing chat routes,
filtered on the caller's own reporter id, and never in the operator route
module. Return a derived state, not the stored status. Prove the boundary with a
cross-user check: a second reporter, the accused, shop staff and an operator must
all fail to see somebody else's report through it.

## Reading the reported conversation is itself an audited act

An operator can read a read-only window of the reported room. That read must:
join nobody to the room, touch no read state or delivery receipt, expose no
handle to stored media, and be written to the access trail *before* any message
content leaves the server — a failed trail write fails the request.

**Why:** the transcript is two private people's messages. The only thing that
makes reading it defensible is that every read names the operator who did it, so
an unlogged read is worse than no transcript at all.

**How to apply:** a client that shows the transcript must fetch it only on a
deliberate open. Disable focus/reconnect/remount refetching, polling and retries
on that query, or ordinary browser lifecycle events silently log repeat reads.
Deleted messages stay legible to operators (flagged as retracted) — otherwise
deleting the reported message defeats the review.

## One search term means one kind of thing

A term typed into the operator search box is read either as a name or as a
mobile, never as both, and the branches must be mutually exclusive: any letter
makes it a name, otherwise it is a number compared digit-to-digit with
formatting and country code stripped from both sides.

**Why:** ORing the two is the tempting shortcut and it answers the wrong
question in both directions — a digits term then also matches names containing
those digits, and a name term's stray digits ("User 1") match everyone whose
number contains a 1. An operator cannot tell a wrong result set from a right
one here, because the queue looks the same either way.

**How to apply:** decide what a too-short or punctuation-only term does and test
it, rather than letting it fall through to the other branch. Escape `%`, `_` and
`\` before the term reaches LIKE. Fixtures need digit-only mobiles — fake
mobiles built from hex contain letters and silently skip the number path.

## A batch decision reaches exactly what the count promised

An operator can record one decision across every report still `open` against
the same reported user. The batch stops there: a sibling already settled, or
already moved to `reviewed`, is skipped and counted as skipped — never
overwritten — and one filed after the batch's locking statement is untouched.

**Why:** the operator agreed to the number the queue showed them ("N other open
reports"). Sweeping in reviewed or settled siblings would move more rows than
the checkbox named, and would erase another operator's recorded judgement of the
same account.

**How to apply:** claim every report about that account in ONE `FOR UPDATE`
statement ordered by id, not the anchor first and siblings second — two
operators batching different reports about the same account otherwise take the
same locks in opposite order and deadlock. An omitted note must be left out of
the `SET` clause entirely, so each row keeps its own earlier note instead of
inheriting the anchor's. Sequential checks cannot see any of this: only firing
two decisions about one account at the same instant distinguishes correct
locking from a deadlock, and under read-committed the outcome is deterministic
(one 200, one 409 with nothing written by the loser), so the race can be
asserted exactly rather than tolerated as flaky.

## A bulk decision is withdrawable; a decision is not reopenable

One click settling several people's complaints gets two safety nets: the batch
is named and confirmed before it runs, and for a short window the operator who
recorded it — nobody else — can withdraw that specific batch. This is not a
reopen and must never grow into one: it restores each report to the exact state
that batch found it in, and it never touches a row another operator has decided
since.

**Why:** the one-way rule above exists so a decision cannot be silently
rewritten, but it was written for one report at a time. A misclick that moves
five strangers' complaints at once needs a way back that is still an audit
trail, so a withdrawal is recorded (who, when, which reports came back) rather
than erasing the batch.

**How to apply:** mark each moved row with the batch that moved it, and clear
that marker on any later decision — ownership of the row, not membership of the
batch, is what a withdrawal checks. Refuse a withdrawal from a different
operator, a second withdrawal, or a lapsed window, and leave the reporters'
alerts alone: they were told a human finished with them, and un-telling them
would expose the operator queue's workings to the people it is kept from.

## Alerts are per person in a batch, per report otherwise

A batch sends one alert to each distinct reporter it settled, keyed by one of
their own affected reports, with wording identical to a single decision's.

**Why:** somebody who filed three complaints about one abuser is one person
waiting for one answer; three identical alerts read as a bug, and the wording
must not become a "this was handled in bulk" variant that hints at outcome.

**How to apply:** dedupe by reporter id while walking the affected rows anchor
first, so the reporter of the report the operator acted from is keyed by that
report and a replayed batch cannot stack alerts.

## A count about an account needs a filter on that account

Anything that drills into "the other reports about this user" filters on the
reported-user id, not on a search for their name.

**Why:** the two parties of a report are symmetrical to a text search, so a name
search answers "reports naming this person at all", including complaints that
person filed about somebody else. A drill-down that disagrees with the count
that opened it teaches operators to distrust the count.
