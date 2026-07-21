import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FinancialScope } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { InsightActionDto } from './dto/insight-action.dto';
import { UpdateAssistantPreferenceDto } from './dto/update-assistant-preference.dto';
import { ProductIntelligenceService } from './product-intelligence.service';

@ApiTags('Din Inteligente')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class ProductIntelligenceController {
  constructor(@Inject(ProductIntelligenceService) private readonly service: ProductIntelligenceService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Consultar preferências de áudio e alertas do Din' })
  async preferences(@CurrentUser() user: JwtPayload) { return { data: await this.service.preferences(user.sub) }; }

  @Patch('preferences')
  @ApiOperation({ summary: 'Atualizar preferências de áudio, frequência e horário silencioso' })
  async updatePreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpdateAssistantPreferenceDto) {
    return { data: await this.service.updatePreferences(user.sub, dto) };
  }

  @Get('insights')
  @ApiOperation({ summary: 'Listar gastos atípicos, previsões e vencimentos explicáveis' })
  async insights(@CurrentUser() user: JwtPayload, @Query('refresh') refresh?: string) {
    return { data: await this.service.list(user.sub, refresh === 'true') };
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Calcular previsão de saldo e explicar a fórmula utilizada' })
  async forecast(@CurrentUser() user: JwtPayload, @Query('scope') scope?: FinancialScope) {
    return { data: await this.service.forecast(user.sub, scope) };
  }

  @Post('insights/:id/action')
  @ApiOperation({ summary: 'Criar orçamento, lembrar depois ou ignorar uma sugestão' })
  async act(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: InsightActionDto) {
    return { data: await this.service.act(user.sub, id, dto) };
  }
}
