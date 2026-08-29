import { registerAs } from '@nestjs/config';

export const cameraConfig = registerAs('camera', () => ({
  chaveCriptografiaStream: process.env.CAMERA_URL_STREAM_ENC_KEY as string,
  heartbeatTimeoutSegundos: Number(process.env.CAMERA_HEARTBEAT_TIMEOUT_SEGUNDOS ?? 300),
  deviceApiKeyPepper: process.env.DEVICE_API_KEY_PEPPER as string,
}));
