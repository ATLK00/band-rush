// store.js
// In-memory store ที่มีรูปโครงสร้างเดียวกับ Redis JSON ใน GDD (ข้อ 6)
// ทำเป็น module แยกต่างหาก เพื่อให้สลับไปใช้ ioredis จริงในอนาคตได้ง่าย
// (แค่เปลี่ยน implementation ของฟังก์ชันด้านล่าง โดยที่ signature เดิม)

const rooms = new Map(); // room_pin -> room object (เทียบเท่า key "room_847291" ใน Redis)

function getRoom(pin) {
  return rooms.get(pin) || null;
}

function setRoom(pin, roomData) {
  rooms.set(pin, roomData);
  return roomData;
}

function deleteRoom(pin) {
  rooms.delete(pin);
}

function allRooms() {
  return rooms;
}

module.exports = { getRoom, setRoom, deleteRoom, allRooms };
