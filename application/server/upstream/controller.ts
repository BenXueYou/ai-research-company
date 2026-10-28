import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createUpstreamController(services: Services) {
  const { upstreamMonitor } = services;
  @Controller('api')
  class UpstreamController {
    @Get('upstream-monitor')
    upstreamOverview(@Req() request: AuthRequest) {
      return upstreamMonitor.overview(request.identity);
    }
    @Post('upstream-monitor/refresh')
    @HttpCode(200)
    upstreamRefresh(@Req() request: AuthRequest) {
      return upstreamMonitor.refresh(request.identity);
    }
  }
  return UpstreamController;
}
