# M5Dial Receiver API Draft

Not integrated.

## Preferred Scan Event

```text
POST /api/scan
```

Request:

```json
{
  "reader_id": "m5dial-eabha",
  "tag_id": "04-AB-CD-EF"
}
```

This already matches Kids Tunes.

## Optional Receiver Status

Future endpoint:

```text
POST /api/receiver-heartbeat
```

Request:

```json
{
  "reader_id": "m5dial-eabha",
  "battery_percent": 100,
  "firmware_version": "0.1.0",
  "wifi_rssi": -55
}
```

Not needed for first integration.
