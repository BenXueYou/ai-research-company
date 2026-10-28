import { Controller, Get, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createOrganizationsController(services: Services) {
  const { organizations } = services;
  @Controller('api')
  class OrganizationsController {
    @Get('organizations')
    organizations(@Req() request: AuthRequest) {
      return organizations.list(request.identity);
    }
    @Post('organizations')
    openOrganization(@Req() request: AuthRequest) {
      return organizations.open(request.identity, request.sessionToken, request.body ?? {});
    }
    @Post('organizations/state')
    organizationState(@Req() request: AuthRequest) {
      return organizations.setActive(request.identity, request.sessionToken, request.body ?? {});
    }
  }
  return OrganizationsController;
}
