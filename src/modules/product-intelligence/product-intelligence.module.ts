import { Module } from '@nestjs/common';
import { ProductIntelligenceController } from './product-intelligence.controller';
import { ProductIntelligenceService } from './product-intelligence.service';

@Module({
  controllers: [ProductIntelligenceController],
  providers: [ProductIntelligenceService],
  exports: [ProductIntelligenceService],
})
export class ProductIntelligenceModule {}
