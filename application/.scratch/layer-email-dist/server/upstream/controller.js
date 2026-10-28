var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
export function createUpstreamController(services) {
    const { upstreamMonitor } = services;
    let UpstreamController = class UpstreamController {
        upstreamOverview(request) {
            return upstreamMonitor.overview(request.identity);
        }
        upstreamRefresh(request) {
            return upstreamMonitor.refresh(request.identity);
        }
    };
    __decorate([
        Get('upstream-monitor'),
        __param(0, Req())
    ], UpstreamController.prototype, "upstreamOverview", null);
    __decorate([
        Post('upstream-monitor/refresh'),
        HttpCode(200),
        __param(0, Req())
    ], UpstreamController.prototype, "upstreamRefresh", null);
    UpstreamController = __decorate([
        Controller('api')
    ], UpstreamController);
    return UpstreamController;
}
//# sourceMappingURL=controller.js.map