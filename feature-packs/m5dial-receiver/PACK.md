# M5Dial Receiver Pack

Status: forward feature pack, not integrated.

## Goal

Prepare the M5Dial v2 as the next Auri receiver hardware for Eabha and Liam.

The receiver should:

- read bank-card-sized RFID/NFC cards;
- send scan events to Auri;
- identify which receiver/child it belongs to;
- eventually use the screen/dial/button for useful local controls.

## Design Position

RFID card support is non-negotiable.

The first goal is scan reliability, not a fancy UI.

Preferred route:

1. Try ESPHome firmware first.
2. Use RC522/I2C support if compatible with the M5Dial hardware.
3. Fall back to Arduino/PlatformIO if ESPHome cannot access the RFID hardware reliably.

## Proposed Scope For First Integration

- Create one M5Dial receiver profile in Auri.
- Flash/test one M5Dial as an RFID scanner.
- Send scan event as JSON to Auri if possible:

```json
{
  "reader_id": "m5dial-eabha",
  "tag_id": "04-..."
}
```

- Confirm Auri routes based on `reader_id`.

## Not In First Integration

- No fancy screen UI.
- No rotary volume control.
- No offline playback.
- No battery/power optimization.
- No multi-account Spotify routing until one receiver is reliable.

## Open Questions

- Exact M5Dial v2 RFID chip and ESPHome compatibility.
- Whether ESPHome can expose the RFID scan in the needed format.
- Whether the dial/button should control volume later.
- What enclosure/power setup is safe in a child's room.

## Integration Notes

Current app already supports receiver profiles by `reader_id`.

The M5Dial should ideally send the same shape as fake scans:

```text
POST /api/scan
```

or connect through ESPHome if using native API.

## Risks

- Firmware support may be the hard part.
- M5Dial RFID range may differ from current PN532 reader.
- Cards may need a specific placement/orientation.
- Screen/dial temptation can distract from scan reliability.

## Proposed Integration Order

1. Buy two M5Dial units.
2. Test one unit only.
3. Identify RFID component and firmware path.
4. Make it produce stable tag IDs.
5. Send fake-equivalent scan into Auri.
6. Create receiver profile `m5dial-eabha`.
7. Test one known card.
8. Clone/adapt for Liam after Eabha unit is stable.
