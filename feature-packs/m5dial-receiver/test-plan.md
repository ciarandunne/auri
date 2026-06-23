# M5Dial Receiver Test Plan

Not integrated.

## Bench Tests

1. Power on M5Dial.
2. Confirm Wi-Fi connection.
3. Scan the same RFID card ten times.
4. Confirm the same tag ID appears each time.
5. Confirm card-sized tags are easy to position.

## Auri Tests

1. Create receiver profile `m5dial-eabha`.
2. Send fake scan with that reader ID.
3. Confirm Auri links scan to receiver.
4. Send real M5Dial scan.
5. Confirm `/activity` shows receiver correctly.
6. Assign/play one card.

## Failure Cases

- Tag ID changes between scans.
- RFID range too short.
- Firmware cannot read cards.
- Device cannot reach Auri on local network.
- Reader ID mismatches receiver profile.
