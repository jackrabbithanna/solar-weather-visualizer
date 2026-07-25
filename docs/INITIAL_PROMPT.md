Develop application to visualize the energy from coronal mass ejections, solar flares, and coronal holes from the sun as it expands into the solar system

Wails based Go / Typescript application, with Vite as a dev tool.

NASA and NOAA provide real-time and historical telemetry:NASA DONKI API (Database Of Notifications, Knowledge, Information):What it gives you: CME speed, angular width, trajectory vector (Latitude/Longitude), Solar Flare class, and Coronal Hole High-Speed Stream predictions.Best for: Event-driven feeds to spawn visualization objects.NOAA SWPC (Space Weather Prediction Center) APIs:What it gives you: Live $L_1$ satellite telemetry (DSCOVR, ACE, IMAP/SOLAR-1) including real-time plasma velocity, density, and Interplanetary Magnetic Field ($B_z$).WSA-ENLIL Model Outputs:What it gives you: NOAA/NASA 3D MHD (magnetohydrodynamic) simulation slices predicting solar wind density and velocity throughout the inner solar system.

Web-Based 3D (Three.js / WebGL / WebGPU)

