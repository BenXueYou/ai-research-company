var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Req, Res } from '@nestjs/common';
export function createCommerceController(services) {
    const { procurement, coefficient, pointOrders, reporting } = services;
    let CommerceController = class CommerceController {
        reports(request) {
            return reporting.overview(request.identity);
        }
        async ownLedgerCsv(request, response) {
            const csv = await reporting.exportOwnLedger(request.identity);
            response.setHeader('Content-Type', 'text/csv; charset=utf-8');
            response.setHeader('Content-Disposition', 'attachment; filename="own-ledger.csv"');
            response.send('\uFEFF' + csv);
        }
        procurementOverview(request) {
            return procurement.overview(request.identity, request.sessionToken);
        }
        coefficientOverview(request) {
            return coefficient.overview(request.identity, request.sessionToken);
        }
        coefficientNotices() {
            return coefficient.notices();
        }
        announceCoefficient(request) {
            return coefficient.announce(request.identity, request.sessionToken, request.body ?? {});
        }
        activateCoefficient(request) {
            return coefficient.activate(request.identity, request.sessionToken, request.body?.id);
        }
        pointOrderOverview(request) {
            return pointOrders.overview(request.identity, request.sessionToken);
        }
        createPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'create', request.body ?? {});
        }
        repricePointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'reprice', request.body ?? {});
        }
        confirmPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'confirm', request.body ?? {});
        }
        reservePointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'reserve', request.body ?? {});
        }
        transferPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'transfer', request.body ?? {});
        }
        refundPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'refund', request.body ?? {});
        }
        purchase(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'purchase', request.body ?? {});
        }
        expense(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'expense', request.body ?? {});
        }
        pricing(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'pricing', request.body ?? {});
        }
    };
    __decorate([
        Get('reports'),
        __param(0, Req())
    ], CommerceController.prototype, "reports", null);
    __decorate([
        Get('reports/own-ledger.csv'),
        __param(0, Req()),
        __param(1, Res())
    ], CommerceController.prototype, "ownLedgerCsv", null);
    __decorate([
        Get('procurement'),
        __param(0, Req())
    ], CommerceController.prototype, "procurementOverview", null);
    __decorate([
        Get('coefficient'),
        __param(0, Req())
    ], CommerceController.prototype, "coefficientOverview", null);
    __decorate([
        Get('coefficient/notices')
    ], CommerceController.prototype, "coefficientNotices", null);
    __decorate([
        Post('coefficient/announcements'),
        __param(0, Req())
    ], CommerceController.prototype, "announceCoefficient", null);
    __decorate([
        Post('coefficient/activate'),
        __param(0, Req())
    ], CommerceController.prototype, "activateCoefficient", null);
    __decorate([
        Get('point-orders'),
        __param(0, Req())
    ], CommerceController.prototype, "pointOrderOverview", null);
    __decorate([
        Post('point-orders'),
        __param(0, Req())
    ], CommerceController.prototype, "createPointOrder", null);
    __decorate([
        Post('point-orders/reprice'),
        __param(0, Req())
    ], CommerceController.prototype, "repricePointOrder", null);
    __decorate([
        Post('point-orders/confirm'),
        __param(0, Req())
    ], CommerceController.prototype, "confirmPointOrder", null);
    __decorate([
        Post('point-orders/reserve'),
        __param(0, Req())
    ], CommerceController.prototype, "reservePointOrder", null);
    __decorate([
        Post('point-orders/transfer'),
        __param(0, Req())
    ], CommerceController.prototype, "transferPointOrder", null);
    __decorate([
        Post('point-orders/refund'),
        __param(0, Req())
    ], CommerceController.prototype, "refundPointOrder", null);
    __decorate([
        Post('procurement/purchases'),
        __param(0, Req())
    ], CommerceController.prototype, "purchase", null);
    __decorate([
        Post('procurement/expenses'),
        __param(0, Req())
    ], CommerceController.prototype, "expense", null);
    __decorate([
        Post('procurement/pricing'),
        __param(0, Req())
    ], CommerceController.prototype, "pricing", null);
    CommerceController = __decorate([
        Controller('api')
    ], CommerceController);
    return CommerceController;
}
//# sourceMappingURL=controller.js.map