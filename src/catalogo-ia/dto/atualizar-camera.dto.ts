import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { StatusCamera } from '../../shared/enums/dominio.enums.js';
import { CriarCameraDto } from './criar-camera.dto.js';

/**
 * obraId nao muda por aqui: uma camera nao troca de obra depois de
 * instalada. `status` e exclusivo do PATCH (nao existe no cadastro
 * inicial, que sempre nasce ATIVA) — permite marcar MANUTENCAO manualmente;
 * OFFLINE por falta de heartbeat continua automatico (CameraHeartbeatScheduler).
 */
export class AtualizarCameraDto extends PartialType(OmitType(CriarCameraDto, ['obraId'] as const)) {
  @ApiPropertyOptional({ enum: StatusCamera })
  @IsOptional()
  @IsEnum(StatusCamera)
  status?: StatusCamera;
}
