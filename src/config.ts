/**
 * CH347 Device Configuration
 *
 * Functions to list CH347 devices with their serial numbers.
 */

import * as usb from 'usb';
import {
  CH347_VID,
  CH347_PID_SPI_I2C_UART,
  CH347_PID_JTAG_I2C_UART,
} from './constants';
import { getWindowsBackend } from './usb';
import { isWCHDLLAvailable } from './wch-dll';
import { WCHBackend } from './backend-wch';

export interface CH347DeviceWithSerial {
  index: number;
  vendorId: number;
  productId: number;
  busNumber: number;
  deviceAddress: number;
  serialNumber: string | null;
  manufacturer: string | null;
  product: string | null;
}

/**
 * Check if WCH backend should be used
 */
function shouldUseWCHBackend(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  return getWindowsBackend() === 'wch' && isWCHDLLAvailable();
}

/**
 * List all connected CH347 devices with their serial numbers.
 * Note: When using WCH backend, serial numbers are not available (returns null).
 */
export async function listDevicesWithSerial(): Promise<CH347DeviceWithSerial[]> {
  // Use WCH backend if selected (serial numbers not available)
  if (shouldUseWCHBackend()) {
    const wchDevices = WCHBackend.listDevices();
    return wchDevices.map((device, index) => ({
      index,
      vendorId: device.vendorId,
      productId: device.productId,
      busNumber: device.busNumber,
      deviceAddress: device.deviceAddress,
      serialNumber: null,
      manufacturer: null,
      product: null,
    }));
  }

  // Use libusb backend (can get serial numbers)
  const devices: CH347DeviceWithSerial[] = [];
  const allDevices = usb.getDeviceList();

  let index = 0;
  for (const device of allDevices) {
    const desc = device.deviceDescriptor;
    if (
      desc.idVendor === CH347_VID &&
      (desc.idProduct === CH347_PID_SPI_I2C_UART ||
        desc.idProduct === CH347_PID_JTAG_I2C_UART)
    ) {
      const info: CH347DeviceWithSerial = {
        index,
        vendorId: desc.idVendor,
        productId: desc.idProduct,
        busNumber: device.busNumber,
        deviceAddress: device.deviceAddress,
        serialNumber: null,
        manufacturer: null,
        product: null,
      };

      // Try to read string descriptors
      try {
        device.open();

        if (desc.iSerialNumber) {
          info.serialNumber = await getStringDescriptor(device, desc.iSerialNumber);
        }
        if (desc.iManufacturer) {
          info.manufacturer = await getStringDescriptor(device, desc.iManufacturer);
        }
        if (desc.iProduct) {
          info.product = await getStringDescriptor(device, desc.iProduct);
        }

        device.close();
      } catch {
        // Device may be in use or require permissions
        try {
          device.close();
        } catch {
          // Ignore close errors
        }
      }

      devices.push(info);
      index++;
    }
  }

  return devices;
}

/**
 * Get USB string descriptor
 */
function getStringDescriptor(device: usb.Device, index: number): Promise<string> {
  return new Promise((resolve, reject) => {
    device.getStringDescriptor(index, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data ?? '');
      }
    });
  });
}

