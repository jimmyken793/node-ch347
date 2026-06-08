import { describe, it } from 'node:test';
import assert from 'node:assert';

import { CH347Flash } from './flash';
import { SPIInterface, SPIConfig } from './types';
import { SPISpeed, SPIMode } from './constants';

class MockSPI implements SPIInterface {
  public sendCommandCalls: Array<{ writeData: Buffer; readLength: number }> = [];
  public commandCalls: Buffer[] = [];

  constructor(private readonly jedecResponse: Buffer) {}

  async init(): Promise<void> {}

  async sendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    this.sendCommandCalls.push({ writeData: Buffer.from(writeData), readLength });

    if (writeData[0] === 0x9f) {
      return Buffer.from(this.jedecResponse);
    }

    if (writeData[0] === 0x05) {
      return Buffer.from([0x02]);
    }

    return Buffer.alloc(readLength, 0xff);
  }

  async command(writeData: Buffer, readLength = 0): Promise<Buffer> {
    this.commandCalls.push(Buffer.from(writeData));
    if (readLength > 0) {
      return Buffer.alloc(readLength, 0xff);
    }
    return Buffer.alloc(0);
  }

  async transfer(data: Buffer): Promise<Buffer> {
    return Buffer.from(data);
  }

  async write(): Promise<void> {}

  async read(length: number): Promise<Buffer> {
    return Buffer.alloc(length, 0xff);
  }

  async writeRead(data: Buffer): Promise<Buffer> {
    return Buffer.from(data);
  }

  async setChipSelect(): Promise<void> {}

  async csControl(): Promise<void> {}

  getConfig(): SPIConfig {
    return {
      speed: SPISpeed.CLK_15M,
      mode: SPIMode.MODE_0,
      chipSelect: 0,
      bitOrder: 'MSB',
    };
  }

  isReady(): boolean {
    return true;
  }
}

async function flashWithJedec(jedec: number): Promise<{ flash: CH347Flash; spi: MockSPI }> {
  const spi = new MockSPI(Buffer.from([
    (jedec >> 16) & 0xff,
    (jedec >> 8) & 0xff,
    jedec & 0xff,
  ]));
  const flash = new CH347Flash(spi);
  await flash.readJedecId();
  return { flash, spi };
}

describe('CH347Flash JEDEC sizing', () => {
  it('identifies SST25VF016B as 2 MiB', async () => {
    const { flash } = await flashWithJedec(0xbf2541);
    const info = flash.getFlashInfo();

    assert.strictEqual(info?.name, 'SST25VF016B');
    assert.strictEqual(info?.size, 2 * 1024 * 1024);
  });

  it('does not infer non-standard unknown capacity byte 0x41 as 2 bytes', async () => {
    const { flash } = await flashWithJedec(0xaa1141);
    const info = flash.getFlashInfo();

    assert.notStrictEqual(info?.size, 2);
    assert.strictEqual(info?.size, 0);
  });

  it('uses exponent fallback for standard capacity bytes', async () => {
    const { flash } = await flashWithJedec(0xaa1115);
    const info = flash.getFlashInfo();

    assert.strictEqual(info?.size, 2 * 1024 * 1024);
  });
});

describe('CH347Flash 4-byte address commands', () => {
  it('uses 4-byte read command above 16 MiB', async () => {
    const { flash, spi } = await flashWithJedec(0xef4019);

    await flash.read(0x1000000, 4);

    const readCall = spi.sendCommandCalls.find(call => call.writeData[0] === 0x13);
    assert.ok(readCall);
    assert.deepStrictEqual([...readCall.writeData], [0x13, 0x01, 0x00, 0x00, 0x00]);
  });

  it('uses 4-byte page program command above 16 MiB', async () => {
    const { flash, spi } = await flashWithJedec(0xef4019);

    await flash.write(0x1000000, Buffer.from([0xaa]));

    const programCommand = spi.commandCalls.find(command => command[0] === 0x12);
    assert.ok(programCommand);
    assert.deepStrictEqual([...programCommand], [0x12, 0x01, 0x00, 0x00, 0x00, 0xaa]);
  });

  it('uses 4-byte sector erase command above 16 MiB', async () => {
    const { flash, spi } = await flashWithJedec(0xef4019);

    await flash.eraseSector(0x1000000);

    const eraseCommand = spi.commandCalls.find(command => command[0] === 0x21);
    assert.ok(eraseCommand);
    assert.deepStrictEqual([...eraseCommand], [0x21, 0x01, 0x00, 0x00, 0x00]);
  });

  it('keeps 24-bit read command below 16 MiB', async () => {
    const { flash, spi } = await flashWithJedec(0xef4019);

    await flash.read(0x00fffffc, 4);

    const readCall = spi.sendCommandCalls.find(call => call.writeData[0] === 0x03);
    assert.ok(readCall);
    assert.deepStrictEqual([...readCall.writeData], [0x03, 0xff, 0xff, 0xfc]);
  });

  it('uses 4-byte read command when a read crosses 16 MiB', async () => {
    const { flash, spi } = await flashWithJedec(0xef4019);

    await flash.read(0x00fffffc, 8);

    const readCall = spi.sendCommandCalls.find(call => call.writeData[0] === 0x13);
    assert.ok(readCall);
    assert.deepStrictEqual([...readCall.writeData], [0x13, 0x00, 0xff, 0xff, 0xfc]);
  });
});

describe('CH347Flash range validation', () => {
  it('rejects negative read addresses', async () => {
    const { flash } = await flashWithJedec(0xef4015);

    await assert.rejects(() => flash.read(-1, 1), /address must be a non-negative safe integer/);
  });

  it('rejects reads beyond known flash size', async () => {
    const { flash } = await flashWithJedec(0xef4015);

    await assert.rejects(() => flash.read(2 * 1024 * 1024, 1), /exceeds flash size/);
  });
});
