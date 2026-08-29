/**
 * Escopos que uma credencial de dispositivo pode ter. Uma camera
 * comprometida fisicamente com escopo minimo (so heartbeat, por exemplo)
 * limita o estrago ao que aquele escopo permite — e o mesmo raciocinio do
 * usuario IAM `hardware-rpi01` restrito a `PutObject` num prefixo so.
 */
export const ESCOPO_DETECCAO_INGERIR = 'deteccao:ingerir';
export const ESCOPO_HEARTBEAT = 'heartbeat:enviar';

export const ESCOPOS_DISPOSITIVO = [ESCOPO_DETECCAO_INGERIR, ESCOPO_HEARTBEAT] as const;

export type EscopoDispositivo = (typeof ESCOPOS_DISPOSITIVO)[number];
