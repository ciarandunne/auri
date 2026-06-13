# M5Dial Receiver Plan

This note captures the current thinking for buying and testing two M5Stack Dial devices as upgraded Kids Tunes receivers.

## Decision

Buy two M5Dial devices:

- One as an upgrade for Eabha.
- One as Liam's first receiver.

The M5Dial is a good fit for the long-term Kids Tunes direction because it combines:

- RFID/NFC card scanning.
- ESP32-S3 Wi-Fi.
- A screen for status and now-playing feedback.
- A rotary encoder for future volume/control behavior.
- A buzzer/speaker for optional feedback.

The current PN532 ESPHome reader remains the stable baseline while the Dial path is tested.

## Why It Looks Viable

Official M5Stack documentation says the M5Dial includes a 13.56 MHz RFID module supporting ISO/IEC 14443 Type A/B cards. The docs specifically recommend standard bank-card-sized RFID cards for reliable recognition, which matches the Kids Tunes cards.

The official M5Dial Arduino library includes an RFID example that reads card UIDs with:

```cpp
M5Dial.Rfid.PICC_IsNewCardPresent()
M5Dial.Rfid.PICC_ReadCardSerial()
```

That means a custom firmware route is credible even if ESPHome is awkward.

ESPHome also has an `rc522_i2c` component for RC522-style RFID readers over I2C. The M5Dial RFID reader appears to use the same general RC522/MFRC522-style API at I2C address `0x28`, so an ESPHome proof of concept is worth trying first.

## Preferred Firmware Route

Try ESPHome first.

Expected shape:

```text
M5Dial RFID scan
-> ESPHome rc522_i2c on_tag
-> HTTP POST to Kids Tunes /api/scan
-> Kids Tunes receiver routing
-> Spotify/Echo playback
```

Reason:

- Keeps the device simple.
- Keeps OTA/config workflow close to the current ESPHome reader.
- Can post directly to Kids Tunes without Home Assistant being the main brain.

## Fallback Firmware Route

If ESPHome is too limited or unreliable, use Arduino/PlatformIO firmware.

Expected shape:

```text
M5Dial Arduino firmware
-> read RFID UID with official M5Dial library
-> POST JSON to Kids Tunes /api/scan
```

Example scan payload:

```json
{
  "reader_id": "m5dial-eabha",
  "tag_id": "04-DB-B5-3E-9E-61-80"
}
```

This route should also let us use the screen and dial more freely.

## Receiver IDs

Proposed reader IDs:

```text
m5dial-eabha
m5dial-liam
```

The same card catalog should work on both receivers. The receiver ID decides which child, Spotify account, speaker, and volume rules apply.

## First Test Plan

1. Flash or load the simplest RFID test firmware.
2. Confirm the M5Dial reads the existing bank-card-sized tags.
3. Compare UID formatting against the current Kids Tunes card IDs.
4. Send a fake POST from a laptop using the proposed reader ID.
5. Send a real POST from the M5Dial to Kids Tunes.
6. Add `m5dial-eabha` as a receiver in Kids Tunes.
7. Repeat for `m5dial-liam`.

## Risks

- ESPHome support may need experimentation because the M5Dial is not the same PN532-based reader we already have.
- The exact RFID chip/module behavior must be tested with the actual cards.
- If ESPHome cannot read tags cleanly, custom Arduino/PlatformIO firmware will be needed.
- Display/dial support in ESPHome may be more work than RFID alone.

## Useful Sources

- M5Dial docs: https://docs.m5stack.com/en/core/M5Dial
- M5Dial Arduino library: https://github.com/m5stack/M5Dial
- M5Dial RFID example: https://raw.githubusercontent.com/m5stack/M5Dial/master/examples/Basic/rfid/rfid.ino
- ESPHome RC522 docs: https://esphome.io/components/binary_sensor/rc522/
- ESPHome HTTP request docs: https://esphome.io/components/http_request/

## Recommendation

Buy the two M5Dial devices, ideally from somewhere with easy returns. The evidence is strong enough to proceed, but the first unit should be treated as a hardware proof of concept before depending on the pair.
