import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BusinessEntryStatus, BusinessEntryType } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { BusinessService } from './business.service';
import { CreateBusinessEntryDto } from './dto/create-business-entry.dto';
import { SettleBusinessEntryDto } from './dto/settle-business-entry.dto';
import { UpdateBusinessEntryDto } from './dto/update-business-entry.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

@ApiTags('Negócio')
@ApiBearerAuth('access-token')
@Controller('business')
export class BusinessController {
  constructor(private readonly service: BusinessService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumo previsto e realizado do negócio' })
  async summary(@CurrentUser() user: JwtPayload) {
    return { data: await this.service.summary(user.sub) };
  }

  @Get('settings')
  async settings(@CurrentUser() user: JwtPayload) {
    return { data: await this.service.settings(user.sub) };
  }

  @Patch('settings')
  async updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateBusinessSettingsDto) {
    return { data: await this.service.updateSettings(user.sub, dto) };
  }

  @Get('entries')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('type') type?: BusinessEntryType,
    @Query('status') status?: BusinessEntryStatus,
  ) {
    return { data: await this.service.list(user.sub, type, status) };
  }

  @Post('entries')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBusinessEntryDto) {
    return { data: await this.service.create(user.sub, dto) };
  }

  @Patch('entries/:id')
  async update(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessEntryDto) {
    return { data: await this.service.update(user.sub, id, dto) };
  }

  @Post('entries/:id/settle')
  async settle(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleBusinessEntryDto) {
    return { data: await this.service.settle(user.sub, id, dto) };
  }

  @Delete('entries/:id')
  @HttpCode(204)
  async cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.cancel(user.sub, id);
  }
}
