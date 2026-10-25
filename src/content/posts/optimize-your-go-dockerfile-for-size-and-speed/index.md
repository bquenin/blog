---
title: "Optimize Your Go Dockerfile for Size and Speed"
pubDatetime: 2022-08-21T22:33:00.000Z
description: "When developing a REST API microservice, you are responsible for delivering a container for your application."
tags:
  - "api"
  - "web-development"
  - "docker"
  - "go"
  - "programming"
canonicalURL: "https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-e0070aa1b383"
ogImage: "./1-6cLcltnCI-BZtZ323rjRHA.png"
---

_Originally published on [Medium](https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-e0070aa1b383) on August 21, 2022._

### Build a Modern REST API With Go — Part 4

![Photo by Guillaume Bolduc on Unsplash](./1-6cLcltnCI-BZtZ323rjRHA.png)

_Photo by [Guillaume Bolduc](https://unsplash.com/@guibolduc?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText) on [Unsplash](https://unsplash.com/s/photos/container?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)_

This article is the fourth in a series covering all the aspects of implementing a modern REST API microservice step by step:

1. [Defining a SQL first data model with sqlc](/posts/build-a-modern-rest-api-with-go-and-postgresql-part-1/)
2. [Implementing the REST API with Gin](/posts/modern-rest-api-with-go-and-postgresql-part-2/)
3. [Configuring with Viper](/posts/configure-your-go-microservice-for-cloud-using-viper/)
4. **Building and running in a container**
5. [Containerized tests](/posts/containerize-your-go-unit-and-integration-tests/)

All the code for the series is available at [https://github.com/bquenin/modern-go-rest-api-tutorial](https://github.com/bquenin/modern-go-rest-api-tutorial)

## What are our Execution Environments?

To better understand what we need to build, we need to know what execution environments we are targeting:

- **Production environment**: We want to run our containerized application in an environment that is as close as possible to the production environment,
- **Development environment**: We also want a fast development cycle where we can run, stop and restart our application without needing to containerize it. Typically, this is useful when developing a new feature, implementing tests, debugging an issue, profiling, etc.

## The Production Environment

When developing a REST API microservice, you are responsible for delivering a container for your application. Once the container has been built, you will probably need to push it to a container registry of your choice so the application can be deployed into your production environment.

We will not cover the whole deployment process for a containerized application in this tutorial, but we will cover the following topics:

- Building the production container image,
- Running this image in a stack mimicking the production environment using docker-compose.

### Size matters

Having a small footprint is crucial in a containerized world. Indeed, your image will be built, compressed, pushed to a registry, and pulled from that registry countless times. Not only a bigger image will cause a longer time to do all these operations, but it will also induce much higher costs as cloud providers charge for storage and network usage!

This is why small-footprint OSes such as [Alpine](https://www.alpinelinux.org/) come in very handy. Alpine is a very small Linux distribution tailored to run containerized applications and striving for the smallest possible footprint. The size of the compressed image is [a little bit more than 2MB](https://hub.docker.com/_/alpine/tags).

Go is a perfect choice for building containerized applications. Indeed, the fact that binaries are statically linked makes it very easy to package them into a container. You could even build an image with only the go binary inside (FROM scratch), and it would still work!

Here, we are using Alpine as a base image because it is very useful to have a shell and other commands when you debug a running container and attach to it.

### Building the Container Image

There are multiple ways to build an OCI-compliant container image, but in this tutorial, we will use Docker. To keep our container image small, we will use a multi-stage build process:

```dockerfile file=Dockerfile
FROM golang:1.19.0-alpine3.16 as builder
WORKDIR /work

# Download module in a separate layer to allow caching for the Docker build
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY api ./api
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -o microservice ./cmd/microservice/main.go

FROM alpine:3.16.2
WORKDIR /bin
COPY --from=builder /work/microservice /bin/microservice
ENV GIN_MODE=release
CMD /bin/microservice
```

_Multi-stage Docker build_

1. Building the go binary: We are using the official Go docker image. To enable caching, we first download the go modules. This will create a separate layer that can be reused across builds, greatly reducing the build time. Then, we copy the source code and build the Go binary.
2. Building the production image: We use the official Alpine image and **COPY** the go binary we have just built `--from` the previous layer.

The resulting image is minimal as it only contains the Alpine OS and the go binary. None of the build artifacts (source code, imported packages, etc.) are in the final image.

Note that we are pinning the images down to specific versions. You want to be as precise as possible, as Docker image tags are aliases and may point to different images over time. Pinning down specific versions ensures that you have reproducible builds, meaning that if any issue arises with a given build, you can reproduce it confidently.

### Defining our Service Stack

Now that we have our container, we want to run it in an environment as close as possible to the production environment. To achieve this, we are going to use docker-compose. [Compose](https://docs.docker.com/compose/) is a tool for defining and running multi-container Docker applications. With Compose, you use a YAML file to configure your application’s services. Then, you create and start all the services from your configuration with a single command.

Our stack only needs 2 services: the Postgres database and our microservice. We can describe this stack using Compose as follows:

```yaml file=stack.yml
version: "3.9"

services:
  microservice:
    image: microservice:local
    build:
      context: .
    environment:
      APP_POSTGRES_HOST: postgres
      APP_POSTGRES_PASSWORD: password
    ports:
    - "8080:8080"

  postgres:
    image: postgres:14.5-alpine3.16
    environment:
      POSTGRES_PASSWORD: password
    configs:
    - source: postgres-schema
      target: /docker-entrypoint-initdb.d/schema.sql
    volumes:
    - postgres-data:/var/lib/mysql

configs:
  postgres-schema:
    file: sql/schema.sql

volumes:
  postgres-data:
```

## microservice

It’s our application microservice.

It includes a **build** section that tells Compose to build the container when we’re starting the stack. If you have modified the source code, a new image will be built to reflect those changes.

As mentioned in the previous article, we are configuring our application using **environment** variables to specify the Postgres database hostname and password. Please note that a service DNS name comes from the service name defined in the stack. In this case, Postgres is reachable on the **postgres** DNS name.

By default, containers do not export their ports to the local host. So we need to specify a port mapping to reach the service on port 8080. You can learn more about [Compose networking](https://docs.docker.com/compose/networking/) here.

### Postgres

This is our Postgres database service. We are using the official image from the Docker hub.

As for the other service, we configure it using environment variables to specify the password. In a production deployment, a configuration manager or other means, such as a Kubernetes secret, would provide this environment variable.

To initialize our database schema, we rely on the containerized database convention and mount our schema.sql to the **/docker-entrypoint-initdb.d** folder. You can read more about this [mechanism here](https://hub.docker.com/_/postgres).

Finally, we use a named volume to store Postgres data. In this tutorial, we make sure to erase the volume between restarts but you could keep the volume between restarts to reuse existing data.

### A Note About Security

In this tutorial, we provide the database password using environment variables in the Docker compose file. The default database password is checked in the source code repository for convenience. However, remember **never to check any sensitive information** in the source code repository.

In our case, the deployment pipeline could set the database password environment variable by performing a [variable substitution in the Compose](https://docs.docker.com/compose/environment-variables/#substitute-environment-variables-in-compose-files) file. An even more secure approach would be to rely on a secret management tool such as [Hashicorp Vault](https://www.vaultproject.io/) combined with [Kubernetes secrets](https://kubernetes.io/docs/concepts/configuration/secret/) or [Docker secrets](https://docs.docker.com/engine/swarm/secrets/).

## The Development Environment

Let’s now have a look at the development environment. The only fundamental difference is that we do not want our microservice to run in the stack. We want to start our service using our favorite IDE or other means.

We still need to have the Postgres database running and reachable. Indeed, the production Postgres service does not export any ports, so connecting to it from outside the stack is impossible. We need to expose this port in development mode.

Hopefully, we can express those differences just by creating another stack file:

```yaml file=stack.dev.yml
version: "3.9"

services:
  microservice:
    deploy:
      replicas: 0

  postgres:
    ports:
    - "5432:5432"
```

We can start our stack in development by combining this file with the production stack. The number of replicas is set to 0 for the microservice, so no instance is running in the stack, and the Postgres service exposes its port to the host.

We only need to start our microservice instance and configure it, using environment variables, to connect to the Postgres instance from the stack (accessible on localhost:5432).

## Wrapping it All Together

Now that we have our stacks, we need to use convenient commands to be able to start and stop them. For this, we are going to use a good old Makefile:

```makefile file=Makefile
# Stack
.PHONY:	stop
stop:
	@docker compose -f stack.yml down -v

.PHONY:	prod
prod:
	@docker compose -f stack.yml down -v
	@docker compose -f stack.yml up --build

.PHONY: dev
dev:
	@docker compose -f stack.yml down -v
	@docker compose -f stack.yml -f stack.dev.yml up
```

You can now use the following command:

- `make prod`: to start the production environment where you can connect to your microservice on localhost:8080,
- `make dev`: to start the dev environment where you can connect to the database on localhost:5432.
- `make stop`: to stop any of the stacks gracefully.

## What’s Next?

Now that we have covered the production and development environments, we will have a look at [how to write and containerize our integration tests](/posts/containerize-your-go-unit-and-integration-tests/)!
