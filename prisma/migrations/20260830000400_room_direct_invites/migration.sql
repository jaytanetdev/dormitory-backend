ALTER TABLE "RoomInvite" ALTER COLUMN "contractId" DROP NOT NULL;
ALTER TABLE "RoomInvite" ADD COLUMN "roomId" TEXT;

ALTER TABLE "RoomInvite"
  ADD CONSTRAINT "RoomInvite_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RoomInvite_storeId_roomId_status_idx" ON "RoomInvite"("storeId", "roomId", "status");
