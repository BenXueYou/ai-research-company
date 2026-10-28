import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createCommerceController(services: Services) {
  const { procurement, coefficient, pointOrders, reporting } = services;
  @Controller('api')
  class CommerceController {
    @Get('reports')
    reports(@Req() request: AuthRequest) {
      return reporting.overview(request.identity);
    }
    @Get('reports/own-ledger.csv')
    async ownLedgerCsv(@Req() request: AuthRequest, @Res() response: Response) {
      const csv = await reporting.exportOwnLedger(request.identity);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="own-ledger.csv"');
      response.send('\uFEFF' + csv);
    }
    @Get('procurement')
    procurementOverview(@Req() request: AuthRequest) {
      return procurement.overview(request.identity, request.sessionToken);
    }
    @Get('coefficient')
    coefficientOverview(@Req() request: AuthRequest) {
      return coefficient.overview(request.identity, request.sessionToken);
    }
    @Get('coefficient/notices')
    coefficientNotices() {
      return coefficient.notices();
    }
    @Post('coefficient/announcements')
    announceCoefficient(@Req() request: AuthRequest) {
      return coefficient.announce(request.identity, request.sessionToken, request.body ?? {});
    }
    @Post('coefficient/activate')
    activateCoefficient(@Req() request: AuthRequest) {
      return coefficient.activate(request.identity, request.sessionToken, request.body?.id);
    }
    @Get('point-orders')
    pointOrderOverview(@Req() request: AuthRequest) {
      return pointOrders.overview(request.identity, request.sessionToken);
    }
    @Post('point-orders')
    createPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'create', request.body ?? {});
    }
    @Post('point-orders/reprice')
    repricePointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'reprice', request.body ?? {});
    }
    @Post('point-orders/confirm')
    confirmPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'confirm', request.body ?? {});
    }
    @Post('point-orders/transfer')
    transferPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'transfer', request.body ?? {});
    }
    @Post('point-orders/refund')
    refundPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'refund', request.body ?? {});
    }
    @Post('procurement/purchases')
    purchase(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'purchase', request.body ?? {});
    }
    @Post('procurement/expenses')
    expense(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'expense', request.body ?? {});
    }
    @Post('procurement/pricing')
    pricing(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'pricing', request.body ?? {});
    }
  }
  return CommerceController;
}
