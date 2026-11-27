# @kc/infrastructure-api

The app's adapters for KC's own API, and the one definition of the wire format both sides use ([ADR-010](../../../docs/architecture/adr/ADR-010-port-gateway.md)).

```ts
const transport = createPortTransport({ baseUrl, getAccessToken });
const users = createRemotePort<IUserRepository>(transport, 'users');
await users.follow(me, them); // POST /v1/ports/users/follow
```

- `createRemotePort<Port>(transport, name, { methods, fallback })` is the generic adapter for every application port. While the API serves only part of a port, list the served `methods` and pass the current adapter as `fallback`.
- `createPortTransport` sends the call with the member's access token, refreshes it once on `401`, and aborts after a timeout with an error the app already treats as a timeout.
- A typed domain or application error thrown on the server arrives as an instance of the same class (`instanceof`, `.code` and extra fields intact). Any other failure is a `PortCallError` with the API's code and request id.
- `src/wire` (the call path, argument encoding and error codec) is imported by the API too. Change it only together with the gateway, and never in a way an installed app build would not understand.
