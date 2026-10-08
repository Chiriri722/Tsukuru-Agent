# Data model

- Probe root: unique owned temporary payload/profile/staging/status directory.
- Profile paths: home, appData, userData, sessionData, temp, logs, crash dumps and environment-derived roaming/local caches. Parent environment is never changed.
- Bootstrap proof: private marker after synchronous readback, before original main. No marker means unconfirmed isolation even with exit code zero.
- Process proof: bounded broker report including root exit/timeout/cancel and zero-active confirmation. Missing report is failure.
- Public isolation: strategy, verified, processTreeTerminated and cleanup state. No dedicated profile path field; existing bounded stdout/error diagnostics can contain paths.

Lifecycle: allocated → prepared → launched → observed → tree terminated → removed. Preparation refusal can go directly to removed. Unconfirmed termination retains the probe root and reports failure. Never fall back to inherited profile.
