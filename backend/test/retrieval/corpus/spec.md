# Meridian API Reference

This document describes the public REST API for integrating with the Meridian Holdings
inventory platform. It is intended for third-party logistics partners building automated
integrations against order, inventory, and shipment data. The API follows conventional
REST semantics: resources are addressed by URL, state changes go through `POST`, `PATCH`,
and `DELETE`, and every response body is JSON.

## Overview

The API is versioned at `/v1` and returns JSON for every endpoint. Requests must be made
over HTTPS; plaintext HTTP requests are rejected with a redirect. The base URL for
production traffic is `https://api.meridianholdings.example/v1`; a separate sandbox host
mirrors the same contract with synthetic data for integration testing before a partner is
approved for production credentials.

## Authentication

Every request must carry a valid credential in the `X-Api-Key` request header. Keys are
issued from the partner console and never expire on their own, though they can be revoked
at any time from that same console. A typical request looks like:

```
GET /v1/orders/8842 HTTP/1.1
Host: api.meridianholdings.example
X-Api-Key: mk_live_9f2a1c7e4b3d...
```

Requests missing this header, or presenting a key that has been revoked, receive an HTTP
401 response with a JSON body describing the problem. A request whose key is valid but
lacks the scope for the requested resource receives an HTTP 403 instead. Scopes are
assigned per key in the partner console — a key can be limited to read-only access, or to
a specific subset of endpoints such as inventory lookups without order-creation rights.

Partners integrating server-to-server should treat the key as a long-lived secret: store
it in a secrets manager, never commit it to source control, and rotate it if it is ever
exposed in a log line or an error report. The console supports issuing a second, parallel
key so a rotation can happen without downtime: issue the new key, deploy it, confirm
traffic has shifted, then revoke the old one.

There is no separate login step and no session concept — every request is authenticated
independently by the header above, which keeps the integration stateless on both sides.

## Rate Limiting

Each key is limited to 600 requests per minute, measured in a sliding window. Responses
carry `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers so a client can back off
before hitting the limit rather than after. Exceeding the limit returns HTTP 429 with a
`Retry-After` header in seconds. Sustained overages may result in the key being throttled
further by the partner success team; contact them before building a workload that expects
to run near the ceiling continuously.

## Pagination

List endpoints return at most 100 items per page. Pass `?cursor=` with the value from the
previous response's `next_cursor` field to fetch the following page; a `next_cursor` of
`null` means the caller has reached the end of the collection. Cursors are opaque and
should not be constructed or parsed by the client.

## Errors

Every error response follows the same envelope:

```json
{ "error": { "code": "string", "message": "human readable string" } }
```

`code` is a stable machine-readable string (e.g. `invalid_key`, `resource_not_found`,
`validation_failed`) suitable for programmatic branching; `message` is for logs and humans
and may change wording between API versions without notice.

## Webhooks

Partners may register a webhook URL to receive `inventory.updated` and `order.shipped`
events. Each delivery includes an `X-Meridian-Signature` header computed as an HMAC-SHA256
of the raw request body, so the receiver can verify the payload was not tampered with in
transit. A delivery that does not receive a `2xx` response is retried with exponential
backoff for up to 24 hours before being dropped and surfaced in the partner console as a
failed delivery.
