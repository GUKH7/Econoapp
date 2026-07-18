import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BusinessEntryStatus, BusinessEntryType } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { BusinessService } from './business.service';
import { CreateBusinessEntryDto } from './dto/create-business-entry.dto';
import { CreateBusinessContactDto } from './dto/create-business-contact.dto';
import { CreateBusinessOfferingDto } from './dto/create-business-offering.dto';
import { SettleBusinessEntryDto } from './dto/settle-business-entry.dto';
import { UpdateBusinessContactDto } from './dto/update-business-contact.dto';
import { UpdateBusinessOfferingDto } from './dto/update-business-offering.dto';
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

  @Get('contacts')
  async listContacts(@CurrentUser() user: JwtPayload) {
    return { data: await this.service.listContacts(user.sub) };
  }

  @Post('contacts')
  async createContact(@CurrentUser() user: JwtPayload, @Body() dto: CreateBusinessContactDto) {
    return { data: await this.service.createContact(user.sub, dto) };
  }

  @Patch('contacts/:id')
  async updateContact(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessContactDto) {
    return { data: await this.service.updateContact(user.sub, id, dto) };
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  async deleteContact(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.deleteContact(user.sub, id);
  }

  @Get('offerings')
  async listOfferings(@CurrentUser() user: JwtPayload) {
    return { data: await this.service.listOfferings(user.sub) };
  }

  @Post('offerings')
  async createOffering(@CurrentUser() user: JwtPayload, @Body() dto: CreateBusinessOfferingDto) {
    return { data: await this.service.createOffering(user.sub, dto) };
  }

  @Patch('offerings/:id')
  async updateOffering(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessOfferingDto) {
    return { data: await this.service.updateOffering(user.sub, id, dto) };
  }

  @Delete('offerings/:id')
  @HttpCode(204)
  async deleteOffering(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.deleteOffering(user.sub, id);
  }

  @Get('product-report')
  async productReport(@CurrentUser() user: JwtPayload, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return { data: await this.service.productReport(user.sub, startDate, endDate) };
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
