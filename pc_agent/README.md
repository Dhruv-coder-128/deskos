# DESK OS — Windows Workstation PC Agent (Phase 3)

The **DESK OS PC Agent** is a lightweight, secure Python host service running on your Windows 11 laptop (Lenovo LOQ). It communicates with the touchscreen Android panel (Samsung Galaxy M01s) over an authenticated, TLS-pinned WebSocket (`wss://`) connection.

---

## 1. System Requirements

- **Operating System:** Windows 10 or Windows 11 (64-bit)
- **Python:** Python 3.10, 3.11, 3.12, 3.13, or 3.14
- **Dependencies:** All free and open-source (`fastapi`, `uvicorn`, `pydantic`, `websockets`, `cryptography`)
- **Cost / Accounts:** $0. No paid subscriptions, cloud services, or external APIs required.

---

## 2. Installation & Quickstart

### Step 1: Open Terminal in the `pc_agent` directory
Open PowerShell or Windows Terminal:
```powershell
cd "x:\ALL PROJECTS\deskOS\pc_agent"
```

### Step 2: (Recommended) Create and activate a Virtual Environment
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### Step 3: Install Free Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Run the PC Agent
```powershell
python agent.py
```
Upon startup, the agent will:
1. Automatically generate a self-signed local X.509 TLS certificate (`certs/cert.pem` and `certs/key.pem`) valid for your computer's LAN IP, localhost, and hostname.
2. Calculate the certificate's SHA-256 fingerprint.
3. Generate a 6-digit random **Pairing PIN**.
4. Output a Cyberpunk terminal dashboard:

```text
====================================================================
           DESK OS // WORKSTATION PC AGENT (PHASE 3)
====================================================================
  HOST NAME      : Lenovo-LOQ
  STATUS         : RUNNING [AUTHENTICATION ENFORCED]
  LISTEN PORT    : 8765
  LOCAL LAN IP(S): 192.168.1.45, 127.0.0.1
  SECURE CHANNEL : WSS (TLS PINNED)
--------------------------------------------------------------------
  [!] ACTIVE PAIRING PIN      : 839201
  [!] SHA-256 TLS FINGERPRINT : 26:05:03:84:1E:...
--------------------------------------------------------------------
```

---

## 3. Finding Your Laptop's LAN IP Address

The agent automatically prints all detected IPv4 addresses on startup. If you want to verify manually:
1. Open PowerShell and run:
   ```powershell
   ipconfig
   ```
2. Locate your active Wi-Fi or Ethernet adapter:
   Look for the line **IPv4 Address**, e.g.: `192.168.1.45`.
3. Use this IP address on your phone control panel.

---

## 4. Windows Firewall Configuration

When running the agent for the first time, Windows Defender Firewall may display an alert.

1. **Allow Access:** Ensure both **Private networks** and **Domain networks** are checked, then click **Allow access**.
2. **If connection times out on the phone:** You can quickly open inbound port `8765` for TCP in PowerShell (Run as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "DESK OS PC Agent" -Direction Inbound -LocalPort 8765 -Protocol TCP -Action Allow
   ```

---

## 5. Pairing Your Android Phone

1. Ensure your Samsung Galaxy M01s is on the same local Wi-Fi network (or connected via USB ADB).
2. Open the **DESK OS** app on your phone.
3. In the **HOST WORKSTATION LINK** card on the dashboard, tap **[PAIR WORKSTATION]**.
4. In the Cyberpunk pairing modal, enter:
   - **Host LAN IP:** Enter the IP printed in the PC terminal (e.g. `192.168.1.45`, or `127.0.0.1` if testing via USB).
   - **Port:** `8765`
   - **Pairing PIN:** Enter the 6-digit PIN displayed in the terminal.
   - **SHA-256 Fingerprint:** Enter the fingerprint displayed in the terminal.
5. Tap **[CONFIRM & PAIR]**.
6. The app verifies the TLS certificate fingerprint against the server's certificate. If verified, it completes the pairing handshake, securely stores the generated session token in the **Android Keystore**, and establishes the live WebSocket connection. The status pill changes to **CONNECTED** (neon green).

---

## 6. CLI Management Commands

- **Revoke All Paired Devices:**
  ```powershell
  python agent.py --revoke-all
  ```
  Immediately invalidates all existing phone authorizations.

- **Generate a Fresh Pairing PIN:**
  ```powershell
  python agent.py --new-pin
  ```

- **Run on a Custom Port:**
  ```powershell
  python agent.py --port 9000
  ```

- **Run Automated Test Suite:**
  ```powershell
  python tests\test_agent.py
  ```

---

## 7. Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"HOST UNREACHABLE"** | Phone and laptop are on different networks, or Windows Firewall is blocking inbound port 8765. | Check `ipconfig`. Ensure phone is on the same Wi-Fi SSID. Add firewall rule for port 8765. |
| **"CERTIFICATE FINGERPRINT MISMATCH"** | The certificate fingerprint entered on the phone does not match the server's certificate. | Re-check the fingerprint string in the PC agent terminal. Ensure all 32 hex pairs match. |
| **"INVALID PAIRING PIN"** | The entered PIN does not match or expired (>15 mins). | Check the terminal for the active PIN. Run `python agent.py --new-pin` if expired. |
| **"RATE LIMITED (429)"** | More than 5 failed pairing attempts within 60 seconds. | Wait 60 seconds for the security cooldown to reset. |
| **"USB ADB Testing"** | Testing via USB cable without Wi-Fi. | Run `adb reverse tcp:8765 tcp:8765`, then use IP `127.0.0.1` on the phone. |

