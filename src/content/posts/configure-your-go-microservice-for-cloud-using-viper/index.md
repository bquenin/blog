---
title: "Configure Your Go Microservice for Cloud Using Viper"
pubDatetime: 2022-08-19T23:29:54.000Z
description: "When it comes to configuring an application, there are plenty of options."
tags:
  - "programming"
  - "web-development"
  - "go"
  - "microservices"
canonicalURL: "https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-1d48767a813"
ogImage: "./1-Poq7n64LqdvFVBnNk8FhLw.png"
---

_Originally published on [Medium](https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-1d48767a813) on August 19, 2022._

### Build a Modern REST API With Go — Part 3

![Photo by Austin Lowman on Unsplash](./1-Poq7n64LqdvFVBnNk8FhLw.png)

_Photo by [Austin Lowman](https://unsplash.com/@shutter_hunter) on [Unsplash](https://unsplash.com/)_

This article is the third in a series covering all the aspects of implementing a modern REST API microservice step by step:

1. [Defining a SQL first data model with sqlc](/posts/build-a-modern-rest-api-with-go-and-postgresql-part-1/)
2. [Implementing the REST API with Gin](/posts/modern-rest-api-with-go-and-postgresql-part-2/)
3. **Configuring with Viper**
4. [Building and running in a container](/posts/optimize-your-go-dockerfile-for-size-and-speed/)
5. [Containerized tests](/posts/containerize-your-go-unit-and-integration-tests/)

All the code for the series is available at:

[GitHub - bquenin/go-modern-rest-api-tutorial: This is a REST microservice sample. It features: A…](https://github.com/bquenin/modern-go-rest-api-tutorial)

---

## Which Configuration Mechanism to Use?

When it comes to configuring an application, there are plenty of options. You could use command line parameters, a configuration file, environment variables, remote configuration services (such as `etcd`, consul, etc.), or a combination of all.

Each mechanism makes sense, depending on your use case. As we are building a microservice that will eventually be containerized, it doesn’t make much sense for us to rely on command line parameters. Indeed, to play nice with an orchestrator, such as Kubernetes or others, our container should start right away, ideally without requiring any additional configuration.

Any value that needs to be provided or overridden should be done using environment variables. This gives the operation team a lot of flexibility and plays nicely with all container-based deployment tools.

However, if your application has a lot of parameters, you don’t want to burden the operator with providing lots of values to start the application. Therefore, we’re going to use a mix of a configuration file and environment variables:

- The configuration file contains all the default values and is embedded in the go binary: you neither want to expose your configuration file nor document it. It’s an implementation detail; you could later decide to get default values directly from the code or fetch them from a remote configuration service.
- Any value can be overridden using environment variables: this is your public configuration mechanism and must be documented.

This seems like a lot of work, but thankfully, there are a lot of configuration libraries out there for Go. One of the most well-known libraries is [Viper](https://github.com/spf13/viper), which handles our use case nicely.

## Implementing the Configuration

So far, we have been following the standard layout for a Go application, and our project structure looks like this:

```text
└── cmd
    └── microservice
        └── main.go
```

There are various approaches to where to put the configuration code, but we will put it right next to the main package. After all, the configuration will encompass the whole application and potentially span over all packages. Following that rationale, our project structure will look like this:

```text
└── cmd
    └── microservice
        ├── config
        │   ├── config.go
        │   └── config.yml
        └── main.go
```

### Defining our Configuration Model

No, we won’t review the code-first, config-first approaches here! The only rule you should follow is to break down the configuration into blocks that make sense for the user. For our sample application, we only have configuration data for the database, so our configuration is trivial:

```go file=config.go
package config

// ...

type Postgres struct {
	Host     string
	User     string
	Password string
}

type Config struct {
	Postgres *Postgres
}
```

Now that we have defined our configuration model, we can use Viper to read a configuration file and enable the environment variable overriding mechanism.

### Configuration File

Viper supports [a lot of configuration file formats](https://github.com/spf13/viper#reading-config-files). We are going to use YAML for this tutorial:

```yaml file=microservice.yml
postgres:
  host: localhost
  user: postgres
  password: changeme
```

_The default configuration_

As mentioned earlier, the configuration file contains all the default values for our application.

### A Note About Security

Note that the default configuration file must not contain sensitive data such as passwords, secrets, API keys, etc. Instead, provide non-working default values that must be overridden at runtime, such as the “`changeme`” value above.

In this tutorial, we override the configuration using environment variables. While this is fine for running a local stack, an actual production deployment with solid security will most probably rely on a secret management tool such as [Hashicorp Vault](https://www.vaultproject.io/) combined with [Kubernetes secrets](https://kubernetes.io/docs/concepts/configuration/secret/).

### Embedding the Configuration File

To embed our configuration file, we are using the [`//go:embed`](https://pkg.go.dev/embed) [directive](https://pkg.go.dev/embed). As the name suggests, it allows embedding any file into the go binary and using it as a variable at runtime:

```go file=embed.go
package config

// ...

//go:embed config.yml
var defaultConfiguration []byte
```

### Reading the Configuration

We can now read our default configuration using Viper:

1. We enable the environment variables override mechanism,
2. We read the configuration using `ReadConfig`: it will first read the default values from the embedded configuration and then override it with values coming from environment variables, if any.
3. Unmarshal the result into our configuration model

```go file=config.go
package config

// ...

//go:embed config.yml
var defaultConfiguration []byte

type Postgres struct {
	Host     string
	User     string
	Password string
}

type Config struct {
	Postgres *Postgres
}

func Read() (*Config, error) {
	// Environment variables
	viper.AutomaticEnv()
	viper.SetEnvPrefix("APP")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))

	// Configuration file
	viper.SetConfigType("yml")

	// Read configuration
	if err := viper.ReadConfig(bytes.NewBuffer(defaultConfiguration)); err != nil {
		return nil, err
	}

	// Unmarshal the configuration
	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		return nil, err
	}
	return &config, nil
}
```

_Reading configuration using Viper_

### Overriding values using environment variables

Overriding configuration using environment variables works by defining a variable whose name is the “path” of the parameter in the configuration model:

parameter.to.override **→ PREFIX\_PARAMETER\_TO\_OVERRIDE**

For instance, if we want to override the `postgres.password` value, we define the `APP_POSTGRES_PASSWORD` environment variable, as we have configured the prefix to be `APP` for our application.

## Wrapping it up

We can now update our main function accordingly:

```go file=main.go
package main

// ...

func main() {
	// Read configuration
	cfg, err := config.Read()
	if err != nil {
		log.Fatal(err.Error())
	}

	// Instantiates the database
	postgres, err := database.NewPostgres(cfg.Postgres.Host, cfg.Postgres.User, cfg.Postgres.Password)
	if err != nil {
		log.Fatal(err.Error())
	}

	// Instantiates the author service
	queries := database.New(postgres.DB)
	authorService := authors.NewService(queries)

	// Register our service handlers to the router
	router := gin.Default()
	authorService.RegisterHandlers(router)

	// Start the server
	router.Run()
}
```

## What’s Next?

Now that we have implemented the configuration, we will have a look at [how to run the API server in a container](/posts/optimize-your-go-dockerfile-for-size-and-speed/)!
