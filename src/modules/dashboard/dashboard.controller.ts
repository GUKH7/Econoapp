import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { FinancialScope } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthGuard } from '@/common/guards/auth.guard';
import { JwtPayload } from '@/common/types';
import { DashboardSummaryResponse, FinancialReportResponse } from '@/common/types/response.types';
import { DashboardService } from './dashboard.service';
import { FinancialReportQueryDto } from './dto/financial-report-query.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: 'Retorna o relatório financeiro agregado para um período' })
  @Get('reports')
  async report(
    @CurrentUser() user: JwtPayload,
    @Query() query: FinancialReportQueryDto,
  ): Promise<{ data: FinancialReportResponse }> {
    const data = await this.dashboardService.getReport(user.sub, query.startDate, query.endDate, query.scope);
    return { data };
  }

  @ApiOperation({ summary: 'Retorna o resumo financeiro do usuário autenticado' })
  @Get()
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: FinancialScope,
  ): Promise<{ data: DashboardSummaryResponse }> {
    const data = await this.dashboardService.getSummary(user.sub, startDate, endDate, scope);
    return { data };
  }
}
