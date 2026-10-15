@echo off
rem Start de Weekmenu-server (als die nog niet draait) en opent de pagina in de standaardbrowser.
rem Het venster open laten: sluiten stopt de server.
title Weekmenu-server
cd /d "%~dp0"
node weekmenu.js --open
