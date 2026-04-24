import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { ChannelResponse } from '@/common/types/response.types';
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@ApiTags('Channels')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('channels')
export class ChannelController {
  constructor(@Inject(ChannelService) private readonly channelService: ChannelService) {}

  @ApiOperation({ summary: 'Criar um novo canal de comunicação' })
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChannelDto,
  ): Promise<{ data: ChannelResponse }> {
    const data = await this.channelService.create(user.sub, dto);
    return { data: data as unknown as ChannelResponse };
  }

  @ApiOperation({ summary: 'Listar todos os canais do usuário autenticado' })
  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<{ data: ChannelResponse[] }> {
    const data = await this.channelService.findAllByUser(user.sub);
    return { data: data as unknown as ChannelResponse[] };
  }

  @ApiOperation({ summary: 'Atualizar um canal pelo ID' })
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<{ data: { success: boolean } }> {
    await this.channelService.update(user.sub, id, dto);
    return { data: { success: true } };
  }

  @ApiOperation({ summary: 'Remover um canal pelo ID' })
  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ data: { success: boolean } }> {
    await this.channelService.delete(user.sub, id);
    return { data: { success: true } };
  }
}
