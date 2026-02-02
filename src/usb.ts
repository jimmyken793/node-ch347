/**
 * CH347 USB Communication Layer
 */

import * as usb from 'usb';
import * as fs from 'fs';
import * as path from 'path';
import {
  CH347_VID,
  CH347_PID_SPI_I2C_UART,
  CH347_PID_JTAG_I2C_UART,
  CH347_EP_OUT,
  CH347_EP_IN,
  CH347_IFACE_SPI_I2C_GPIO,
  CH347_PACKET_SIZE,
  CH347_TIMEOUT_MS,
} from './constants';
import { CH347DeviceInfo } from './types';

export class CH347USB {
  private device: usb.Device | null = null;
  private interface: usb.Interface | null = null;
  private epIn: usb.InEndpoint | null = null;
  private epOut: usb.OutEndpoint | null = null;
  private isOpen = false;
  private _maxPacketSize = 64; // Default to Full-Speed, updated on open

  /**
   * Get the underlying USB device (for advanced operations)
   */
  getDevice(): usb.Device | null {
    return this.device;
  }

  /**
   * List all connected CH347 devices
   */
  static listDevices(): CH347DeviceInfo[] {
    const devices: CH347DeviceInfo[] = [];
    const allDevices = usb.getDeviceList();

    for (const device of allDevices) {
      const desc = device.deviceDescriptor;
      if (
        desc.idVendor === CH347_VID &&
        (desc.idProduct === CH347_PID_SPI_I2C_UART ||
          desc.idProduct === CH347_PID_JTAG_I2C_UART)
      ) {
        const info: CH347DeviceInfo = {
          vendorId: desc.idVendor,
          productId: desc.idProduct,
          busNumber: device.busNumber,
          deviceAddress: device.deviceAddress,
        };

        // Note: Getting string descriptors requires opening the device
        // which may fail without proper permissions. We skip this for now
        // and just return basic device info.

        devices.push(info);
      }
    }

    return devices;
  }

  /**
   * Open connection to CH347 device
   */
  async open(deviceIndex = 0): Promise<void> {
    const devices = CH347USB.listDevices();
    if (devices.length === 0) {
      throw new Error('No CH347 device found');
    }
    if (deviceIndex >= devices.length) {
      throw new Error(`Device index ${deviceIndex} out of range (${devices.length} devices found)`);
    }

    const targetDevice = devices[deviceIndex];
    const allDevices = usb.getDeviceList();

    // Find the matching device
    this.device = allDevices.find(
      (d) =>
        d.busNumber === targetDevice.busNumber &&
        d.deviceAddress === targetDevice.deviceAddress
    ) ?? null;

    if (!this.device) {
      throw new Error('Failed to find target device');
    }

    try {
      this.device.open();

      // Log device speed and configuration
      if (process.env.DEBUG_USB === '1') {
        const desc = this.device.deviceDescriptor;
        console.log(`[USB] Device: VID=${desc.idVendor.toString(16)} PID=${desc.idProduct.toString(16)}`);
        console.log(`[USB] Device USB version: ${(desc.bcdUSB >> 8).toString(16)}.${(desc.bcdUSB & 0xff).toString(16).padStart(2, '0')}`);
        // List all configurations and interfaces
        const configs = this.device.allConfigDescriptors;
        for (const config of configs) {
          console.log(`[USB] Config ${config.bConfigurationValue}: ${config.interfaces.length} interfaces`);
          for (let i = 0; i < config.interfaces.length; i++) {
            const iface = config.interfaces[i];
            for (const alt of iface) {
              console.log(`[USB]   Interface ${alt.bInterfaceNumber} alt ${alt.bAlternateSetting}: ${alt.endpoints.length} endpoints`);
              for (const ep of alt.endpoints) {
                console.log(`[USB]     EP 0x${ep.bEndpointAddress.toString(16)}: maxPacketSize=${ep.wMaxPacketSize}`);
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to open device: ${message}`);
    }

    // Claim interface 2 for SPI/I2C/GPIO
    try {
      this.interface = this.device.interface(CH347_IFACE_SPI_I2C_GPIO);

      // On Linux, we may need to detach the kernel driver
      if (this.interface.isKernelDriverActive()) {
        this.interface.detachKernelDriver();
      }

      this.interface.claim();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.device.close();
      throw new Error(`Failed to claim interface: ${message}`);
    }

    // Find endpoints and detect max packet size
    for (const endpoint of this.interface.endpoints) {
      if (endpoint.address === CH347_EP_IN) {
        this.epIn = endpoint as usb.InEndpoint;
        // Use the IN endpoint's packet size as our reference
        this._maxPacketSize = endpoint.descriptor.wMaxPacketSize;
        if (process.env.DEBUG_USB === '1') {
          console.log(`[USB] IN endpoint 0x${endpoint.address.toString(16)}: packetSize=${endpoint.descriptor.wMaxPacketSize}, type=${endpoint.transferType}`);
        }
      } else if (endpoint.address === CH347_EP_OUT) {
        this.epOut = endpoint as usb.OutEndpoint;
        if (process.env.DEBUG_USB === '1') {
          console.log(`[USB] OUT endpoint 0x${endpoint.address.toString(16)}: packetSize=${endpoint.descriptor.wMaxPacketSize}, type=${endpoint.transferType}`);
        }
      }
    }

    if (!this.epIn || !this.epOut) {
      this.close();
      throw new Error('Failed to find USB endpoints');
    }

    this.isOpen = true;

    if (process.env.DEBUG_USB === '1') {
      console.log(`[USB] Detected ${this.isHighSpeed() ? 'High-Speed' : 'Full-Speed'} USB (maxPacketSize=${this._maxPacketSize}, maxDataLen=${this.getMaxDataLen()})`);
    }
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.interface) {
      try {
        this.interface.release(true);
      } catch {
        // Ignore
      }
      this.interface = null;
    }

    if (this.device) {
      try {
        this.device.close();
      } catch {
        // Ignore
      }
      this.device = null;
    }

    this.epIn = null;
    this.epOut = null;
    this.isOpen = false;
  }

  /**
   * Check if device is open
   */
  isConnected(): boolean {
    return this.isOpen;
  }

  /**
   * Check if device is operating in High-Speed mode (512-byte packets)
   */
  isHighSpeed(): boolean {
    return this._maxPacketSize >= 512;
  }

  /**
   * Get the maximum USB packet size for bulk transfers
   */
  getMaxPacketSize(): number {
    return this._maxPacketSize;
  }

  /**
   * Get the maximum data payload size (packet size minus 3-byte header)
   * For High-Speed (512-byte): 507 bytes (vendor driver limit)
   * For Full-Speed (64-byte): 60 bytes (with safety margin)
   */
  getMaxDataLen(): number {
    if (this._maxPacketSize >= 512) {
      return 507; // Vendor driver limit for High-Speed
    }
    return 60; // Safe for Full-Speed (64 - 3 header - 1 margin)
  }

  /**
   * Send data to device
   */
  async write(data: Buffer): Promise<number> {
    if (!this.isOpen || !this.epOut) {
      throw new Error('Device not open');
    }

    return new Promise((resolve, reject) => {
      this.epOut!.transfer(data, (err, actual) => {
        if (err) {
          reject(new Error(`USB write error: ${err.message}`));
        } else {
          resolve(actual ?? data.length);
        }
      });
    });
  }

  /**
   * Read data from device
   */
  async read(length: number = CH347_PACKET_SIZE, timeout: number = CH347_TIMEOUT_MS): Promise<Buffer> {
    if (!this.isOpen || !this.epIn) {
      throw new Error('Device not open');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('USB read timeout'));
      }, timeout);

      this.epIn!.transfer(length, (err, data) => {
        clearTimeout(timeoutId);
        if (err) {
          reject(new Error(`USB read error: ${err.message}`));
        } else {
          resolve(data ?? Buffer.alloc(0));
        }
      });
    });
  }

  /**
   * Write and then read response
   */
  async transfer(outData: Buffer, readLength: number = CH347_PACKET_SIZE): Promise<Buffer> {
    await this.write(outData);
    return this.read(readLength);
  }

  /**
   * Bulk write for large data transfers
   */
  async bulkWrite(data: Buffer, chunkSize: number = CH347_PACKET_SIZE): Promise<void> {
    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + chunkSize);
      await this.write(chunk);
      offset += chunkSize;
    }
  }

  /**
   * Bulk read for large data transfers
   */
  async bulkRead(totalLength: number, chunkSize: number = CH347_PACKET_SIZE): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let remaining = totalLength;

    while (remaining > 0) {
      const readSize = Math.min(remaining, chunkSize);
      const data = await this.read(readSize);
      chunks.push(data);
      remaining -= data.length;

      // Break if we got less than expected (end of data)
      if (data.length < readSize) {
        break;
      }
    }

    return Buffer.concat(chunks);
  }

  /**
   * USB control transfer (for vendor-specific commands)
   */
  async controlTransfer(
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    dataOrLength: Buffer | number
  ): Promise<Buffer | number> {
    if (!this.device) {
      throw new Error('Device not open');
    }

    return new Promise((resolve, reject) => {
      this.device!.controlTransfer(
        bmRequestType,
        bRequest,
        wValue,
        wIndex,
        dataOrLength,
        (err, data) => {
          if (err) {
            reject(new Error(`Control transfer error: ${err.message}`));
          } else {
            resolve(data as Buffer | number);
          }
        }
      );
    });
  }

  /**
   * Get USB string descriptor
   */
  async getStringDescriptor(index: number): Promise<string> {
    if (!this.device) {
      throw new Error('Device not open');
    }

    return new Promise((resolve, reject) => {
      this.device!.getStringDescriptor(index, (err, data) => {
        if (err) {
          reject(new Error(`Failed to get string descriptor: ${err.message}`));
        } else {
          resolve(data ?? '');
        }
      });
    });
  }

  /**
   * Get device descriptor info including serial number index
   */
  getDeviceDescriptor(): usb.DeviceDescriptor | null {
    return this.device?.deviceDescriptor ?? null;
  }

  /**
   * Get the UART tty path for this CH347 device
   * On Linux: scans /sys/class/tty for matching USB device
   * On macOS: scans /dev for matching usbmodem device
   */
  getUARTPath(): string | null {
    if (!this.device) {
      return null;
    }

    const busNumber = this.device.busNumber;
    const deviceAddress = this.device.deviceAddress;

    if (process.platform === 'linux') {
      return this.findLinuxTTY(busNumber, deviceAddress);
    } else if (process.platform === 'darwin') {
      return this.findMacOSTTY(busNumber, deviceAddress);
    }

    return null;
  }

  /**
   * Find TTY device on Linux by scanning sysfs
   */
  private findLinuxTTY(busNumber: number, deviceAddress: number): string | null {
    const ttyClassPath = '/sys/class/tty';

    try {
      const entries = fs.readdirSync(ttyClassPath);

      for (const entry of entries) {
        // Only check ttyACM devices (CDC ACM)
        if (!entry.startsWith('ttyACM')) {
          continue;
        }

        const devicePath = path.join(ttyClassPath, entry, 'device');

        try {
          // Resolve symlink to get the actual device path
          const realPath = fs.realpathSync(devicePath);

          // Parse USB device info from path
          // Path looks like: /sys/devices/pci.../usb1/1-1/1-1:1.0/tty/ttyACM0
          // We need to find the USB device part (e.g., 1-1) and check bus/dev
          const usbDevMatch = realPath.match(/usb(\d+)\/[\d.-]+/);
          if (!usbDevMatch) {
            continue;
          }

          // Read busnum and devnum from the USB device directory
          // Go up from the interface to the device
          const interfaceMatch = realPath.match(/(\/sys\/devices\/.*\/usb\d+\/[\d.-]+):\d+\.\d+/);
          if (!interfaceMatch) {
            continue;
          }

          const usbDevicePath = interfaceMatch[1];
          const busnumPath = path.join(usbDevicePath, 'busnum');
          const devnumPath = path.join(usbDevicePath, 'devnum');

          if (fs.existsSync(busnumPath) && fs.existsSync(devnumPath)) {
            const busnum = parseInt(fs.readFileSync(busnumPath, 'utf8').trim(), 10);
            const devnum = parseInt(fs.readFileSync(devnumPath, 'utf8').trim(), 10);

            if (busnum === busNumber && devnum === deviceAddress) {
              return `/dev/${entry}`;
            }
          }
        } catch {
          // Skip entries we can't read
          continue;
        }
      }
    } catch {
      // sysfs not available
    }

    return null;
  }

  /**
   * Find TTY device on macOS
   * macOS names CDC ACM devices as /dev/tty.usbmodem* with location ID
   */
  private findMacOSTTY(_busNumber: number, _deviceAddress: number): string | null {
    try {
      const entries = fs.readdirSync('/dev');

      // Look for usbmodem devices
      const usbmodemDevices = entries
        .filter(e => e.startsWith('tty.usbmodem'))
        .map(e => `/dev/${e}`);

      if (usbmodemDevices.length === 0) {
        return null;
      }

      // On macOS, the location ID is encoded in the device name
      // Format: tty.usbmodem<locationID><suffix>
      // We can try to match by using ioreg, but for simplicity,
      // if there's only one CH347 device, return the first match
      // For multiple devices, user may need to specify manually

      // Try to use system_profiler to match (async would be better but keeping it sync)
      try {
        const { execSync } = require('child_process');
        const output = execSync('system_profiler SPUSBDataType 2>/dev/null', { encoding: 'utf8' });

        // Parse the output to find CH347 device location
        const lines = output.split('\n');
        let inCH347Section = false;
        let locationId = '';

        for (const line of lines) {
          if (line.includes('CH347') || line.includes('1a86')) {
            inCH347Section = true;
          }
          if (inCH347Section && line.includes('Location ID:')) {
            const match = line.match(/Location ID:\s*0x([0-9a-fA-F]+)/);
            if (match) {
              locationId = match[1].toLowerCase();
              break;
            }
          }
        }

        if (locationId) {
          // Match device name containing location ID
          for (const dev of usbmodemDevices) {
            // Location ID is often part of the device name
            if (dev.toLowerCase().includes(locationId.substring(0, 4))) {
              return dev;
            }
          }
        }
      } catch {
        // system_profiler failed, fall through
      }

      // Fallback: return first usbmodem device if only one exists
      if (usbmodemDevices.length === 1) {
        return usbmodemDevices[0];
      }

      // Multiple devices, can't determine which one
      return usbmodemDevices[0]; // Return first as best guess
    } catch {
      // /dev not readable
    }

    return null;
  }
}
