import { RoomClient } from "./net/RoomClient.js";
/** Reads the invitation from the URL fragment and removes it before any request (spec section 20). */
export declare function consumeInviteFragment(loc?: Location, hist?: History): string | null;
export declare function createRoomClient(): RoomClient;
