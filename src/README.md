# Backend Source Layout

- `controllers`: receive HTTP requests, call services, and shape HTTP responses.
- `services`: business logic and orchestration.
- `models`: Mongoose schemas/models and database indexes.
- `routes`: Express route definitions.
- `middleware`: auth, validation, and error handlers.
- `jobs`: background jobs such as expiry alerts.
- `config`: environment and infrastructure configuration.
- `utils`: shared helpers.
- `validators`: request payload validation rules.

Keep controllers thin. Put reusable business rules in services, and keep direct database access behind models or service-level repository helpers.
