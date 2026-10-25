---
title: "Modern REST API With Go and PostgreSQL — Part 2"
pubDatetime: 2022-08-17T21:52:45.000Z
description: "Part 2: REST API with Gin"
tags:
  - "go"
  - "api"
  - "web-development"
  - "programming"
  - "golang"
canonicalURL: "https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-39b0e966534a"
ogImage: "./0-hlL8qyjq2rNmAQEe.jpg"
---

_Originally published on [Medium](https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-39b0e966534a) on August 17, 2022._

## Blazingly fast REST API in Go with Gin

### Build a Modern REST API With Go Part 2

![Photo by Bjarne Vijfvinkel on Unsplash](./0-hlL8qyjq2rNmAQEe.jpg)

_Photo by [Bjarne Vijfvinkel](https://unsplash.com/@capturesbybjarne?utm_source=medium&utm_medium=referral) on [Unsplash](https://unsplash.com?utm_source=medium&utm_medium=referral)_

This article is the second in a series covering all the aspects of implementing a modern REST API microservice step by step:

1. [Defining a SQL first data model with sqlc](/posts/build-a-modern-rest-api-with-go-and-postgresql-part-1/)
2. **Implementing the REST API with Gin**
3. [Configuring with Viper](/posts/configure-your-go-microservice-for-cloud-using-viper/)
4. [Building and running in a container](/posts/optimize-your-go-dockerfile-for-size-and-speed/)
5. [Containerized tests](/posts/containerize-your-go-unit-and-integration-tests/)

All the code for the series is available at [https://github.com/bquenin/modern-go-rest-api-tutorial](https://github.com/bquenin/modern-go-rest-api-tutorial)

## Data Model vs. API Model

As for the data model, we have to design our REST API model. The data model, what is stored in the database, and the REST API model, which is sent over the wire, are similar but not the same. For instance, you will probably have a password field in your user data model that you don’t want to send over the wire.

As such, while similar, the data and API models are not the same and, in some cases, very different. We can apply the same rationale as for the data model to the API model:

- **API First**: There are competing standards, but [OpenAPI](https://swagger.io/specification/) (f.k.a Swagger) is the de facto one. OpenAPI allows you to describe all the aspects of a REST API: resource paths, inputs, outputs, etc. You can generate client and server stubs from that API description in your favorite language. For instance, you could use [oapi-codegen](https://github.com/deepmap/oapi-codegen) to create stubs in Go.
- **Code First**: On the other hand, you can define your API endpoints, inputs, and outputs directly in the code, giving you total control over your resource handlers. In Go, a couple of well-known libraries allow for rapid REST API development, such as [gin](https://gin-gonic.com/), [echo](https://echo.labstack.com/), or [chi](https://go-chi.io/).

Both approaches have pros and cons, and there is already plenty of literature about when to use them. Again, there is no right or wrong answer, as it depends on many factors. This tutorial will follow the code-first approach using the [gin](https://gin-gonic.com/) library.

## Implementing the Author Service

As mentioned previously, we are building a REST API for the sample model provided in sqlc tutorial. We want to implement the following methods:

- Create author on POST /authors
- Get author by id on GET /authors/:id
- Full Update author on PUT /authors/:id
- Partial Update author on PATCH /authors/:id
- Delete author on DELETE /authors/:id
- List authors on GET /authors

First, we need to define our Author service. We’re going to add the _authors.go_ file in the following location:

```text
└── api
    └── authors
        └── authors.go
```

Note that in Go, there is a convention to place all your API services under the **api** folder. If we had multiple services to implement, we could add them under their own folder as follows:

```text
└── api
    ├── authors
    │   └── authors.go
    ├── books
    │   └── books.go
    └── publishers
        └── publishers.go
```

Here is the basic implementation of our Author service:

```go file=authors.go
package authors

// ...

type Service struct {
	queries *database.Queries
}

func NewService(queries *database.Queries) *Service {
	return &Service{queries: queries}
}
```

_Basic implementation of the Author Service_

The only field we need in our service struct is the **queries** object provided by the sqlc generated code. It allows running the SQL queries we’ve defined previously.

## Registering Handlers

We’re now going to define a handler for each API method. A handler is in charge of managing any calls made to a specific HTTP verb and path. As we are using [gin](https://gin-gonic.com/), we will register our handlers to the router like this:

```go file=authors.go
package authors

// ...

type Service struct {
	queries *database.Queries
}

func NewService(queries *database.Queries) *Service {
	return &Service{queries: queries}
}

func (s *Service) RegisterHandlers(router *gin.Engine) {
	router.POST("/authors", s.Create)
	router.GET("/authors/:id", s.Get)
	router.PUT("/authors/:id", s.FullUpdate)
	router.PATCH("/authors/:id", s.PartialUpdate)
	router.DELETE("/authors/:id", s.Delete)
	router.GET("/authors", s.List)
}
```

_Adding the RegisterHandlers method to the Author Service_

## Implementing Handlers

The implementation of a handler is structured in 3 steps:

- **Parse the request:** Validate and sanitize all the input parameters,
- **Perform the request**: Execute the SQL query we’ve defined using sqlc,
- **Build the response**: Redact any sensitive data and return the requested information along with the appropriate HTTP status code.

### Create Author Handler

Following the above structure, we get the following **Create Author** handler:

```go file=create.go
type apiAuthor struct {
	ID   int64
	Name string `json:"name,omitempty" binding:"required,max=32"`
	Bio  string `json:"bio,omitempty" binding:"required"`
}

func (s *Service) Create(c *gin.Context) {
	// Parse request
	var request apiAuthor
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create author
	params := database.CreateAuthorParams{
		Name: request.Name,
		Bio:  request.Bio,
	}
	author, err := s.queries.CreateAuthor(context.Background(), params)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// Build response
	response := fromDB(author)
	c.IndentedJSON(http.StatusCreated, response)
}
```

_Create Author handler_

We are using the `apiAuthor` struct to parse and validate our input. Gin relies on Go struct tags to express the validation constraints of a given field. In our case, we specify that both fields are required and that the name field maximum length is 32.

You can express many validation constraints: maximum length, minimum length, email, UUID, or even bitcoin address! Make sure to check the [documentation of the validator library](https://github.com/go-playground/validator#baked-in-validations) to learn about all the provided validators.

If any constraint is violated, the `ShouldBindJSON` method returns an error that we propagate to the caller.

Once the input is validated, we create the author by calling the `CreateAuthor` function provided by the `queries` object from sqlc.

Finally, we return the author to the caller. We are using the following method to convert a database author to an API author:

```go file=fromDB.go
type apiAuthor struct {
	ID   int64
	Name string `json:"name,omitempty" binding:"required,max=32"`
	Bio  string `json:"bio,omitempty" binding:"required"`
}

func fromDB(author database.Author) *apiAuthor {
	return &apiAuthor{
		ID:   author.ID,
		Name: author.Name,
		Bio:  author.Bio,
	}
}
```

_Convert a database object to an API object_

In this example, there are no differences between the database and the API objects. However, this is typically where redacting would be implemented when required.

### Get Author Handler

Following the above structure, we get the following `Get Author` handler:

```go file=get.go
type pathParameters struct {
	ID int64 `uri:"id" binding:"required"`
}

func (s *Service) Get(c *gin.Context) {
	// Parse request
	var pathParams pathParameters
	if err := c.ShouldBindUri(&pathParams); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get author
	author, err := s.queries.GetAuthor(context.Background(), pathParams.ID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// Build response
	response := fromDB(author)
	c.IndentedJSON(http.StatusOK, response)
}
```

For this API call, the `id` parameter is a path parameter. However, we can follow the same pattern and define a `pathParameters` struct to express our validation constraints and validate it like any other parameter.

Once the input is validated, we return the user from the database.

### Delete Author Handler

Following the above structure, we get the following `Delete Author` handler:

```go file=delete.go
func (s *Service) Delete(c *gin.Context) {
	// Parse request
	var pathParams pathParameters
	if err := c.ShouldBindUri(&pathParams); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Delete author
	if err := s.queries.DeleteAuthor(context.Background(), pathParams.ID); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// Build response
	c.Status(http.StatusOK)
}
```

Again, the only parameter is the **id** path parameter, so we use the same validation mechanism.

We then delete the corresponding author and return an empty response with the OK status code.

### List Author Handler

Following the above structure, we get the following **List Author** handler:

```go file=list.go
func (s *Service) List(c *gin.Context) {
	// List authors
	authors, err := s.queries.ListAuthors(context.Background())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	if len(authors) == 0 {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	// Build response
	var response []*apiAuthor
	for _, author := range authors {
		response = append(response, fromDB(author))
	}
	c.IndentedJSON(http.StatusOK, authors)
}
```

There’s no parameter for this API call so we execute the SQL query and return the results to the caller. Please note that this implementation is trivial. A real-world implementation would provide search queries, filtering, sorting, pagination, etc.

## Updating Authors

There are two kinds of updates you can perform on a REST API resource:

- **A full update**: the caller must provide all the fields for the object they want to replace. Any missing field will be considered an empty value for the update and will blank the corresponding field in the database.
- **A partial update**: the caller only provides the fields to be updated.

Depending on your use case, a full update might be overkill and waste a lot of resources if you want to update a few fields. This is why partial updates are usually preferred.

There are several ways of implementing partial updates. The most commonly known are:

- **JSON Merge Patch**: as defined in [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396.html), defines that only the fields provided in the request should be validated and updated; any missing field should be left unchanged.
- **JSON Patch**: as defined in [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902), defines a patch format where the caller defines the updates to be performed.

In this tutorial, we will follow **JSON Merge Patch** as it’s slightly easier to implement, but both are widely used in the industry.

### Full Update Author Handler

```go file=full_update.go
func (s *Service) FullUpdate(c *gin.Context) {
	// Parse request
	var pathParams pathParameters
	if err := c.ShouldBindUri(&pathParams); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var request apiAuthor
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update author
	params := database.UpdateAuthorParams{
		ID:   pathParams.ID,
		Name: request.Name,
		Bio:  request.Bio,
	}
	author, err := s.queries.UpdateAuthor(context.Background(), params)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// Build response
	response := fromDB(author)
	c.IndentedJSON(http.StatusOK, response)
}
```

The full update requires the ID and the full content of the Author to be updated. We then have to validate both parameters (path and body) accordingly.

Once validated, we update the author in the database and return the updated author as a response.

### Partial Update Author Handler

```go file=partial_update.go
type apiAuthorPartialUpdate struct {
	Name *string `json:"name,omitempty" binding:"omitempty,max=32"`
	Bio  *string `json:"bio,omitempty" binding:"omitempty"`
}

func (s *Service) PartialUpdate(c *gin.Context) {
	// Parse request
	var pathParams pathParameters
	if err := c.ShouldBindUri(&pathParams); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var request apiAuthorPartialUpdate
	if err := c.ShouldBindJSON(&request); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update author
	params := database.PartialUpdateAuthorParams{ID: pathParams.ID}
	if request.Name != nil {
		params.UpdateName = true
		params.Name = *request.Name
	}
	if request.Bio != nil {
		params.UpdateBio = true
		params.Bio = *request.Bio
	}
	author, err := s.queries.PartialUpdateAuthor(context.Background(), params)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// Build response
	response := fromDB(author)
	c.IndentedJSON(http.StatusOK, response)
}
```

The partial update is a bit more complex as we need to accept missing fields, as mentioned before. To accommodate those, we define an `apiAuthorPartialUpdate` struct where:

```go file=apiAuthorPartialUpdate.go
type apiAuthorPartialUpdate struct {
	Name *string `json:"name,omitempty" binding:"omitempty,max=32"`
	Bio  *string `json:"bio,omitempty" binding:"omitempty"`
}
```

1. Fields are nullable: using pointers so we can check whether the field has been provided or not,
2. Validation constraints are changed from “required” to “omitempty”. It tells the underlying validator to validate the field only if it’s present and not to raise any error if it’s missing.

Once the validation is successful, we have to build the partial update parameters for the SQL query. As mentioned earlier, sqlc expects queries to be fully structured, so we have to indicate which column is to be updated or not:

```go file=partial_update_params.go
params := database.PartialUpdateAuthorParams{ID: pathParams.ID}
if request.Name != nil {
	params.UpdateName = true
	params.Name = *request.Name
}
if request.Bio != nil {
	params.UpdateBio = true
	params.Bio = *request.Bio
}
```

Then we update the author and return the updated author to the caller.

## Putting It All Together

Now that we have implemented our handlers, we can update the main function accordingly:

```go file=main.go
package main

// ...

func main() {
	// Instantiate the database
	postgres, err := database.NewPostgres(/* credentials */)
	if err != nil {
		log.Fatal(err.Error())
	}

	// Instantiate the author service
	queries := database.New(postgres.DB)
	authorService := authors.NewService(queries)

	// Register our service handlers to the router
	router := gin.Default()
	authorService.RegisterHandlers(router)

	// Start the server
	router.Run()
}
```

1. Instantiate our database connection, as explained in the previous article,
2. Instantiate our author service with the database queries object,
3. Instantiate the router and register our handlers,
4. Start the server!

## What’s Next?

Now that we have completed our REST API handlers implementation, we will have a [look at how to configure the API server.](/posts/configure-your-go-microservice-for-cloud-using-viper/)
