# Spotify Multi-Account Pack

Status: forward feature pack, not integrated.

## Goal

Support one parent Spotify account for managing/importing playlists, while each child's receiver can play from that child's own Spotify account.

Target model:

- `ciaran.dunne2` owns/manages source playlists.
- Auri imports track/episode metadata from `ciaran.dunne2` playlists.
- Eabha receiver plays through Eabha's own Spotify account and speaker.
- Liam receiver plays through Liam's own Spotify account and speaker.
- The same physical card/content mapping can work on both receivers.

## Design Position

Separate two concepts:

1. Library/import account
   - Used to read parent playlists and import metadata.
   - Does not have to be the same account used for playback.

2. Playback account
   - Used to control Spotify Connect playback for a receiver.
   - Can be one account per child/receiver.

Do not overload the current single global Spotify token once multiple accounts matter.

## Proposed Scope For First Integration

- Add a Spotify accounts table.
- Allow multiple Spotify OAuth connections.
- Mark one account as `library` / import account.
- Link each receiver to a playback account.
- Keep existing current single-account behavior as the default migration path.

## Not In First Integration

- No Spotify Family account automation.
- No web account switching magic.
- No per-card account override.
- No simultaneous playback testing until two child accounts/devices are available.

## Open Questions

- Will Eabha/Liam accounts have Premium/Family capabilities needed for Spotify Connect control?
- Which account owns the Echo Dot devices in Spotify Connect?
- Can each child account see/control its assigned Echo device reliably?
- Should Ciaran's account remain the fallback playback account?

## Integration Notes

Current app stores Spotify tokens in `app_settings`:

- `spotify_access_token`
- `spotify_refresh_token`
- `spotify_expires_at`
- `spotify_default_device_id`

This should migrate into `spotify_accounts`, while keeping legacy settings until migration is proven.

The playlist import code should use the `library` account.

The scan/playback code should use the receiver's `spotify_account_id`.

## Risks

- OAuth flow must know which logical account is being connected.
- Browser may keep logging into the wrong Spotify account.
- Spotify device IDs differ per account.
- The same Echo may appear differently across accounts.
- Multi-account bugs can be confusing because playback may work on one account and fail on another.

## Proposed Integration Order

1. Add visible current connected account display in the existing single-account UI.
2. Validate playlist import with Ciaran account.
3. Create child Spotify accounts.
4. Manually verify each child account can play on its intended Echo/Sonos device.
5. Add `spotify_accounts` table.
6. Add account connection flow with labels.
7. Set Ciaran account as library account.
8. Link receiver profiles to playback accounts.
9. Test one receiver/account at a time.

## Current Decision

Use `ciaran.dunne2` as the library/import account. This is the account where playlists will be created and edited on the go.

Later, create/connect separate Spotify playback accounts for Eabha and Liam. Each receiver should select:

- a child profile;
- a playback Spotify account;
- a default speaker/device;
- safety settings such as start/max volume.

The same card should point to the same content everywhere. The receiver decides which Spotify account and speaker are used for playback.
