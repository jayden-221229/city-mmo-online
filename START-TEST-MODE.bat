@echo off
setlocal
set TEST_MODE=1
set DATA_DIR=
echo Starting City MMO in no-login TEST mode.
echo Test data is stored separately in %%USERPROFILE%%\city-mmo-test-data
echo Your normal accounts and city saves will not be changed.
call npm install
if errorlevel 1 pause & exit /b 1
call npm start
pause
