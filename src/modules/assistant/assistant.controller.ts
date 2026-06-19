import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { AssistantMessageDto } from './dto/assistant-message.dto';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@Controller('assistant')
export class AssistantController {
  constructor(@Inject(WhatsappService) private readonly whatsappService: WhatsappService) {}

  @ApiOperation({ summary: 'Conversar com o Din usando o contexto financeiro do usuario' })
  @Post('message')
  async message(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssistantMessageDto,
  ): Promise<{ data: { reply: string } }> {
    const data = await this.whatsappService.handleAppMessage(user.sub, dto.message);
    return { data };
  }
}
