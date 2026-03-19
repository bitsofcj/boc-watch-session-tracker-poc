Watch Session Tracker
PRD: Real-Time Watch Session Service
FloSports — Backend Engineering Take-Home


Context

FloSports streams live sporting events to hundreds of thousands of concurrent viewers. Understanding how people watch — when they tune in, how long they stay, and when they drop off — is critical for both the product and business teams.
Today, our player SDK fires events to a legacy analytics pipeline that batches data hourly. Product is asking for something closer to real-time: a service that can answer “how many people are watching this event right now?” and “what does a typical viewer session look like?” without waiting for the batch job to finish.

Your task is to build the first version of this service. Think of it as something you’d put in front of your team as a working proof of concept that demonstrates the core approach — not a production-ready system, but something real enough to have an architecture conversation around.


What We Know About the Events
Our player SDK emits events that look roughly like this:
{
  "sessionId": "abc-123",
  "userId": "user-456",
  "eventType": "heartbeat",
  "eventId": "evt-789",
  "eventTimestamp": "2026-02-10T19:32:15.123Z",
  "receivedAt": "2026-02-10T19:32:15.450Z",
  "payload": {
    "eventId": "event-2026-wrestling-finals",
    "position": 1832.5,
    "quality": "1080p"
  }
}
The SDK sends start, heartbeat, pause, resume, seek, quality_change, buffer_start, buffer_end, and end events. Heartbeats fire every 30 seconds while the player is active.
We’re not giving you a starter repo. Set up the project however you think is best.

Requirements


Build a service that:
Accepts incoming viewer events via a REST API
Tracks active watch sessions based on the events received
Exposes two query endpoints:
Current active session count for a given event
Session details for a given session ID (duration so far, current state, events received)
That’s the core. How you model the data and structure the service is up to you.


What the Stakeholders Care About

These aren’t formal requirements — they’re the kind of things that came up in the planning meeting:
Product wants the concurrent viewer count to be “close to real-time” — they’re thinking within 10-15 seconds of reality. They’ll use this number in a dashboard.

Operations does not want to lose events, even during traffic spikes. Events that get dropped are gone forever — there’s no replay mechanism yet.
Engineering wants this service to stay simple. We already have a complex legacy pipeline; the last thing we need is another system that’s hard to reason about. This is a v1.

You’ll notice some tension there. That’s intentional — we’re curious how you navigate it.


Acceptance Criteria

The service starts with a single command (documented in your README)
Tests run with a single command (documented in your README)
The event ingestion endpoint accepts the events described above
The query endpoints return reasonable results


Technical Expectations
Language: Use the language specified in your assessment email
Framework: Your choice
Storage: Keep it simple. If your language/framework supports in-memory state natively (e.g., a long-running process), in-memory is fine for v1. If your language's execution model doesn't lend itself to in-memory state (e.g., request-scoped runtimes), use whatever lightweight persistence makes sense — SQLite, Redis, a file — and tell us why in the README. Either way, don't over-engineer the storage layer. If you'd do something different in production, write about it rather than building it.
Testing: We care more about what you chose to test and why than about coverage percentage


Your README
This matters as much as the code. Please address:
Assumptions you made — This PRD is intentionally broad. What did you assume that wasn’t explicit? What would you have asked the product team if you could?
Tools and resources used — Tell us what you used to build this: AI assistants, documentation, blog posts, reference projects, boilerplate generators — all of it. For AI specifically, what did you use it for?
Trade-offs you made — What did you prioritize? What did you deliberately leave out? Where did you cut scope and why?


How to Work
This assessment is designed to be completed in two hours with heavy AI usage. We expect you to lean on AI tools — that’s not cutting corners, it’s part of what we’re evaluating. We want to see how you course-correct when AI gets it wrong, and whether you understand the code well enough to explain it, modify it, and build on it. In the live round that follows, you’ll walk an engineer through your code and extend it — so make sure you can own everything in the repo.
A few specifics:
Try to commit as you go if it’s natural to your workflow — we know 2 hours is tight, so don’t stress about it, but a commit trail helps us understand how you approached the problem.
Comment naturally. Write the kind of comments you’d write for a teammate who’ll maintain this after you. Not more, not fewer.
Breadth over polish. We’d rather see all the requirements addressed end-to-end than a subset done to perfection. If you’re running low on time, keep moving forward rather than refining what you already have.


Time Expectation
This should take approximately 2 hours. We genuinely mean that — please don’t spend a full weekend on this. A working service with thoughtful trade-offs and a clear README is more valuable to us than a polished, over-engineered submission.
If you find yourself running out of time, stop coding and write about what you would have done. We’d rather read about your thinking than see half-finished features.


Submission
Create a public GitHub repo with your solution and share the link with us. Please make sure the repo is public or that you’ve granted access to the email addresses we provide.
Deadline: 72 hours from when you receive this PRD.
What happens next: If we move forward, one of the subsequent interviews will be a live session where you’ll walk through your code with one of our engineers and extend it together. Come ready to talk about your decisions.
