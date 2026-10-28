var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Req } from '@nestjs/common';
export function createOrganizationsController(services) {
    const { organizations } = services;
    let OrganizationsController = class OrganizationsController {
        organizations(request) {
            return organizations.list(request.identity);
        }
        openOrganization(request) {
            return organizations.open(request.identity, request.sessionToken, request.body ?? {});
        }
        organizationState(request) {
            return organizations.setActive(request.identity, request.sessionToken, request.body ?? {});
        }
    };
    __decorate([
        Get('organizations'),
        __param(0, Req())
    ], OrganizationsController.prototype, "organizations", null);
    __decorate([
        Post('organizations'),
        __param(0, Req())
    ], OrganizationsController.prototype, "openOrganization", null);
    __decorate([
        Post('organizations/state'),
        __param(0, Req())
    ], OrganizationsController.prototype, "organizationState", null);
    OrganizationsController = __decorate([
        Controller('api')
    ], OrganizationsController);
    return OrganizationsController;
}
//# sourceMappingURL=controller.js.map