# node-ch347

A Node.js library for interfacing with WCH CH347 USB devices. Supports GPIO control and SPI flash programming.

> **Note:** This is an early release (v0.0.1). The API may change in future versions.

## Features

- **GPIO Control**: 8 GPIO channels with input/output support
- **SPI Flash Programming**: Read, write, erase, and verify SPI flash chips
  - Supports common chips: W25Qxx, GD25Qxx, MX25Lxx, MT25Qxx, etc.
  - JEDEC ID detection
  - Sector (4KB), block (32KB/64KB), and chip erase
- **UART Path Discovery**: Get the serial port path for use with external libraries
- **Cross-Platform**: Works on Linux and macOS

## Installation

```bash
npm install node-ch347
```

### Prerequisites

**Linux:**
```bash
# Install libusb
sudo apt-get install libusb-1.0-0-dev

# Add udev rules for non-root access
sudo tee /etc/udev/rules.d/99-ch347.rules << EOF
SUBSYSTEM=="usb", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55db", MODE="0666"
EOF
sudo udevadm control --reload-rules
sudo udevadm trigger
```

**macOS:**
```bash
# Install libusb via Homebrew
brew install libusb
```

## Quick Start

```typescript
import CH347Device, { SPISpeed } from 'node-ch347';

async function main() {
  // Create device instance
  const ch347 = new CH347Device({
    spi: { speed: SPISpeed.CLK_15M }
  });

  // Open connection
  await ch347.open();

  // GPIO: Set pin 3 high
  await ch347.gpioWrite(3, true);

  // SPI Flash: Read chip ID
  const flashInfo = await ch347.flashReadId();
  console.log(`Flash: ${flashInfo.name}, ${flashInfo.size / 1024 / 1024} MB`);

  // SPI Flash: Read data
  const data = await ch347.flashRead(0, 4096);

  // Close connection
  ch347.close();
}
```

## API Reference

### CH347Device

Main class that provides unified access to all functionality.

```typescript
const device = new CH347Device(options?: {
  spi?: Partial<SPIConfig>;
});
```

#### Static Methods

- `CH347Device.listDevices()`: List all connected CH347 devices

#### Instance Methods

**Connection:**
- `open(deviceIndex?: number)`: Open device connection
- `close()`: Close connection
- `isConnected()`: Check if connected
- `getUARTPath()`: Get the tty path for this device (e.g., `/dev/ttyACM0`)

**GPIO:**
- `gpioReadAll()`: Read all GPIO pin states
- `gpioRead(pin)`: Read single GPIO pin
- `gpioWrite(pin, value)`: Set GPIO output
- `gpioPulse(pin, duration, activeHigh)`: Pulse GPIO pin

**SPI Flash:**
- `spiInit(config?)`: Initialize SPI interface
- `flashReadId()`: Read JEDEC ID
- `flashRead(address, length, onProgress?)`: Read data
- `flashWrite(address, data, onProgress?)`: Write data
- `flashEraseSector(address)`: Erase 4KB sector
- `flashEraseChip(onProgress?)`: Erase entire chip
- `flashProgram(address, data, options?)`: Erase + write + verify
- `flashProgramFile(filePath, address?, options?)`: Program flash from binary file (if address omitted, file size must match flash size)
- `flashReadToFile(filePath, address?, length?, onProgress?)`: Read flash to binary file

### SPI Configuration

```typescript
interface SPIConfig {
  speed: SPISpeed;      // Clock speed (default: CLK_15M)
  mode: SPIMode;        // SPI mode 0-3 (default: MODE_0)
  chipSelect: 0 | 1;    // CS line (default: 0)
  bitOrder: 'MSB' | 'LSB'; // Bit order (default: 'MSB')
}

enum SPISpeed {
  CLK_60M = 0,
  CLK_30M = 1,
  CLK_15M = 2,
  CLK_7_5M = 3,
  CLK_3_75M = 4,
  CLK_1_875M = 5,
  CLK_937_5K = 6,
  CLK_468_75K = 7,
}
```

## Examples

### GPIO Control

```typescript
import CH347Device from 'node-ch347';

const ch347 = new CH347Device();
await ch347.open();

// Read all GPIO states
const states = await ch347.gpioReadAll();
states.forEach(s => console.log(`GPIO${s.pin}: ${s.value}`));

// Set output on pin 3
await ch347.gpioWrite(3, true);

// Pulse pin 0 (for button press simulation)
await ch347.gpioPulse(0, 100);

ch347.close();
```

### Flash Programming

```typescript
import CH347Device, { SPISpeed } from 'node-ch347';

const ch347 = new CH347Device({ spi: { speed: SPISpeed.CLK_30M } });
await ch347.open();

// Detect flash
const info = await ch347.flashReadId();
console.log(`Detected: ${info.name}`);

// Backup flash to file
await ch347.flashReadToFile('backup.bin', 0, info.size, (p) => {
  console.log(`Reading: ${p.percentage}%`);
});

// Program flash from file (erase + write + verify)
await ch347.flashProgramFile('new_firmware.bin', 0, {
  erase: true,
  verify: true,
  onProgress: (p) => console.log(`${p.operation}: ${p.percentage}%`)
});

ch347.close();
```

### UART Path Discovery

The library provides UART path discovery. Use an external serial library like `serialport` for actual communication:

```typescript
import CH347Device from 'node-ch347';
import { SerialPort } from 'serialport'; // npm install serialport

const ch347 = new CH347Device();
await ch347.open();

// Get UART path for this device
const uartPath = ch347.getUARTPath();
console.log('UART path:', uartPath); // e.g., '/dev/ttyACM0'

// Use serialport library for UART communication
if (uartPath) {
  const port = new SerialPort({ path: uartPath, baudRate: 115200 });
  port.write('AT\r\n');
  // ... handle data with port.on('data', ...)
}

ch347.close();
```

## CH347 Hardware

The CH347 is a USB 2.0 high-speed (480 Mbps) bus converter chip by WCH (Nanjing Qinheng Microelectronics).

**Supported mode:**
- Mode 1 (PID 0x55DB): UART + SPI + I2C + GPIO

**Pin assignments for GPIO (Mode 1):**
- GPIO0: CTS0/SCK/TCK
- GPIO1: RTS0/MISO/TDO
- GPIO2: DSR0/SCS0/TMS
- GPIO3: SCL
- GPIO4: ACT
- GPIO5: DTR0/TNOW0/SCS1/TRST
- GPIO6: CTS1
- GPIO7: RTS1

## Disclaimer

This project was developed with AI-assisted code generation. Not all functions have been fully tested. Use at your own risk.

## License

This project is released into the public domain under [The Unlicense](LICENSE).
