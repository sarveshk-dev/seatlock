-- Run ONCE as a privileged user, connected to the pluggable database XEPDB1:
--   sqlplus system/<your_system_password>@localhost:1521/XEPDB1 @database/00_create_user.sql

CREATE USER seatlock IDENTIFIED BY "SeatLock123";
GRANT CONNECT, RESOURCE TO seatlock;
ALTER USER seatlock QUOTA UNLIMITED ON USERS;
EXIT;
