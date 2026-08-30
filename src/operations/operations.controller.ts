import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped, CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { OperationsService } from './operations.service';
import { CreateBuildingDto, CreateContractDto, CreateInviteDto, CreatePropertyDto, CreateResidentDto, CreateRoomDto, CreateRoomTypeDto, UpdateContractStatusDto, UpdateRoomStatusDto } from './operations.dto';

@ApiBearerAuth() @ApiTags('Property operations') @Controller()
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Get('branches/:branchId/properties') @RequirePermissions('property.view') @BranchScoped() properties(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.properties(u, id); }
  @Post('properties') @RequirePermissions('property.create') @BranchScoped() createProperty(@CurrentUser() u: RequestUser, @Body() d: CreatePropertyDto) { return this.service.createProperty(u, d); }
  @Post('properties/:propertyId/buildings') @RequirePermissions('property.create') createBuilding(@CurrentUser() u: RequestUser, @Param('propertyId') id: string, @Body() d: CreateBuildingDto) { return this.service.createBuilding(u, id, d); }
  @Get('room-types') @RequirePermissions('room.view') roomTypes(@CurrentUser() u: RequestUser) { return this.service.roomTypes(u); }
  @Post('room-types') @RequirePermissions('room.create') createRoomType(@CurrentUser() u: RequestUser, @Body() d: CreateRoomTypeDto) { return this.service.createRoomType(u, d); }
  @Post('buildings/:buildingId/rooms') @RequirePermissions('room.create') createRoom(@CurrentUser() u: RequestUser, @Param('buildingId') id: string, @Body() d: CreateRoomDto) { return this.service.createRoom(u, id, d); }
  @Patch('rooms/:roomId/status') @RequirePermissions('room.update') updateRoom(@CurrentUser() u: RequestUser, @Param('roomId') id: string, @Body() d: UpdateRoomStatusDto) { return this.service.updateRoomStatus(u, id, d.status); }
  @Get('branches/:branchId/residents') @RequirePermissions('resident.view') @BranchScoped() residents(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.residents(u, id); }
  @Post('residents') @RequirePermissions('resident.create') @BranchScoped() createResident(@CurrentUser() u: RequestUser, @Body() d: CreateResidentDto) { return this.service.createResident(u, d); }
  @Get('branches/:branchId/contracts') @RequirePermissions('contract.view') @BranchScoped() contracts(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.contracts(u, id); }
  @Post('contracts') @RequirePermissions('contract.create') @BranchScoped() createContract(@CurrentUser() u: RequestUser, @Body() d: CreateContractDto) { return this.service.createContract(u, d); }
  @Patch('contracts/:contractId/status') @RequirePermissions('contract.update') setContract(@CurrentUser() u: RequestUser, @Param('contractId') id: string, @Body() d: UpdateContractStatusDto) { return this.service.setContractStatus(u, id, d.status); }
  @Post('contracts/:contractId/invites') @RequirePermissions('contract.invite') invite(@CurrentUser() u: RequestUser, @Param('contractId') id: string, @Body() d: CreateInviteDto) { return this.service.createInvite(u, id, d); }
}
