---
title: "Build a Modern REST API With Go and PostgreSQL — Part 1"
pubDatetime: 2022-08-17T02:03:14.000Z
description: "Part 1: SQL First data model with sqlc"
tags:
  - "web-development"
  - "api"
  - "programming"
  - "sql"
  - "go"
canonicalURL: "https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-c765d571b9e7"
ogImage: "./1-YpFLpJaxkfSiCi57JAB8FQ.jpeg"
---

_Originally published on [Medium](https://medium.com/better-programming/modern-rest-api-with-go-and-postgresql-c765d571b9e7) on August 16, 2022._

## REST API in Go with PostgreSQL and sqlc

### Build a Modern REST API With Go Part 1

![Photo by Sunder Muthukumaran on Unsplash](./1-YpFLpJaxkfSiCi57JAB8FQ.jpeg)

_Photo by [Sunder Muthukumaran](https://unsplash.com/@sunder_2k25?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText) on [Unsplash](https://unsplash.com/s/photos/sql?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)_

This article is the first in a series covering all the aspects of implementing a modern REST API microservice step by step:

1. **Defining a SQL First data model with sqlc**
2. [Implementing the REST API with Gin](/posts/modern-rest-api-with-go-and-postgresql-part-2/)
3. [Configuring with Viper](/posts/configure-your-go-microservice-for-cloud-using-viper/)
4. [Building and running in a container](/posts/optimize-your-go-dockerfile-for-size-and-speed/)
5. [Containerized tests](/posts/containerize-your-go-unit-and-integration-tests/)

All the code for the series is available at [https://github.com/bquenin/go-modern-rest-api-tutorial](https://github.com/bquenin/go-modern-rest-api-tutorial)

## What is The Source of Truth for our Data Model?

There are usually two main approaches for synchronizing your database models and queries with your code:

- **Code first**: The code is the source of truth, and the database schema is generated from it. This is what ORM libraries such as [gorm](https://github.com/go-gorm/gorm) do.
- **SQL first**: Conversely, the SQL schema is the source of truth, and the code is generated from it. The most popular library for this is [sqlc](https://sqlc.dev/).

Both approaches have their pros and cons. Code first is usually better when you want the ORM library to handle all the boilerplate CRUD operations for you. However, it could get in the way if you want to fine-tune your database queries. In this case, the SQL first approach may be more appropriate, allowing you to have complete control over your database schema and fine-tuning your SQL queries, which could be necessary depending on the type of APIs you are building. However, with this approach, you will have to write all the SQL queries yourself.

There is no right or wrong answer on which is better. It entirely depends on what you feel more comfortable with, as you can build production-grade applications using both. In this tutorial, we will focus on the SQL first approach and use [sqlc](https://sqlc.dev/) to generate the code from our SQL schemas and queries.

## SQL First Data Model

Defining the data model is a key step in implementing a REST API microservice. You must manipulate the right concepts and understand your consumer domain well.

However, this is beyond the scope of this tutorial, and we will focus solely on how to build a REST API microservice step by step. Therefore, we will use the same model as in the sqlc tutorial:

```sql file=schema.sql
CREATE TABLE authors
(
    id   BIGSERIAL PRIMARY KEY,
    name VARCHAR(32) NOT NULL,
    bio  TEXT NOT NULL
);
```

```sql file=queries.sql
-- name: CreateAuthor :one
INSERT INTO authors (name, bio)
VALUES ($1, $2)
RETURNING *;

-- name: GetAuthor :one
SELECT *
FROM authors
WHERE id = $1
LIMIT 1;

-- name: UpdateAuthor :one
UPDATE authors
SET name = $2,
    bio  = $3
WHERE id = $1
RETURNING *;

-- name: PartialUpdateAuthor :one
UPDATE authors
SET name = CASE WHEN @update_name::boolean THEN @name::VARCHAR(32) ELSE name END,
    bio  = CASE WHEN @update_bio::boolean THEN @bio::TEXT ELSE bio END
WHERE id = @id
RETURNING *;

-- name: DeleteAuthor :exec
DELETE
FROM authors
WHERE id = $1;

-- name: ListAuthors :many
SELECT *
FROM authors
ORDER BY name;
```

The _schema.sql_ file describes a simple Author object, and the _queries.sql file_ provides all the CRUDL (Create, Read, Update, Delete, and List) queries. As you can notice, each query is preceded by a comment providing the name of the function to be generated and how many results it returns (one of **exec, one,** and **many**). This example is trivial, but consult the sqlc documentation if your model is more complex.

The partial update SQL query is more complex as queries in sqlc must be fully structured in advance. Therefore, each field is conditionally updated based on the presence of an associated boolean. For instance, the **name** field is updated only if the **update\_name** field is true.

Many thanks to [Brandur](https://medium.com/u/9644bc03a055) for his [nice article about sqlc and Postgres](https://brandur.org/sqlc).

## Generating the Go code

First, we need to configure sqlc:

```yaml file=sqlc.yaml
version: "2"
sql:
- schema: "sql/schema.sql"
  queries: "sql/queries.sql"
  engine: "postgresql"
  gen:
    go:
      package: "database"
      out: "internal/database"
```

In this case, we are configuring `sqlc` to produce Postgres-compatible code. We’re also specifying the schema and queries files, output path, and package name for the generated code. Our project structure looks like this:

```text
├── sql
│   ├── queries.sql
│   └── schema.sql
└── sqlc.yaml
```

We can now generate the code by running the following command:

```bash
sqlc generate
```

It generates the following files:

```text
├── internal
│   └── database
│       ├── db.go
│       ├── models.go
│       └── queries.sql.go
├── sql
│   ├── queries.sql
│   └── schema.sql
└── sqlc.yaml
```

```go file=models.go
// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.15.0

package database

import ()

type Author struct {
	ID   int64
	Name string
	Bio  string
}
```

```go file=queries.sql.go
// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.15.0
// source: queries.sql

package database

import (
	"context"
)

const createAuthor = `-- name: CreateAuthor :one
INSERT INTO authors (name, bio)
VALUES ($1, $2)
RETURNING id, name, bio
`

type CreateAuthorParams struct {
	Name string
	Bio  string
}

func (q *Queries) CreateAuthor(ctx context.Context, arg CreateAuthorParams) (Author, error) {
	row := q.db.QueryRowContext(ctx, createAuthor, arg.Name, arg.Bio)
	var i Author
	err := row.Scan(&i.ID, &i.Name, &i.Bio)
	return i, err
}

const deleteAuthor = `-- name: DeleteAuthor :exec
DELETE
FROM authors
WHERE id = $1
`

func (q *Queries) DeleteAuthor(ctx context.Context, id int64) error {
	_, err := q.db.ExecContext(ctx, deleteAuthor, id)
	return err
}

const getAuthor = `-- name: GetAuthor :one
SELECT id, name, bio
FROM authors
WHERE id = $1
LIMIT 1
`

func (q *Queries) GetAuthor(ctx context.Context, id int64) (Author, error) {
	row := q.db.QueryRowContext(ctx, getAuthor, id)
	var i Author
	err := row.Scan(&i.ID, &i.Name, &i.Bio)
	return i, err
}

const listAuthors = `-- name: ListAuthors :many
SELECT id, name, bio
FROM authors
ORDER BY name
`

func (q *Queries) ListAuthors(ctx context.Context) ([]Author, error) {
	rows, err := q.db.QueryContext(ctx, listAuthors)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Author
	for rows.Next() {
		var i Author
		if err := rows.Scan(&i.ID, &i.Name, &i.Bio); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const partialUpdateAuthor = `-- name: PartialUpdateAuthor :one
UPDATE authors
SET name = CASE WHEN $1::boolean THEN $2::VARCHAR(32) ELSE name END,
    bio  = CASE WHEN $3::boolean THEN $4::TEXT ELSE bio END
WHERE id = $5
RETURNING id, name, bio
`

type PartialUpdateAuthorParams struct {
	UpdateName bool
	Name       string
	UpdateBio  bool
	Bio        string
	ID         int64
}

func (q *Queries) PartialUpdateAuthor(ctx context.Context, arg PartialUpdateAuthorParams) (Author, error) {
	row := q.db.QueryRowContext(ctx, partialUpdateAuthor,
		arg.UpdateName,
		arg.Name,
		arg.UpdateBio,
		arg.Bio,
		arg.ID,
	)
	var i Author
	err := row.Scan(&i.ID, &i.Name, &i.Bio)
	return i, err
}

const truncateAuthor = `-- name: TruncateAuthor :exec
TRUNCATE authors
`

func (q *Queries) TruncateAuthor(ctx context.Context) error {
	_, err := q.db.ExecContext(ctx, truncateAuthor)
	return err
}

const updateAuthor = `-- name: UpdateAuthor :one
UPDATE authors
SET name = $2,
    bio  = $3
WHERE id = $1
RETURNING id, name, bio
`

type UpdateAuthorParams struct {
	ID   int64
	Name string
	Bio  string
}

func (q *Queries) UpdateAuthor(ctx context.Context, arg UpdateAuthorParams) (Author, error) {
	row := q.db.QueryRowContext(ctx, updateAuthor, arg.ID, arg.Name, arg.Bio)
	var i Author
	err := row.Scan(&i.ID, &i.Name, &i.Bio)
	return i, err
}
```

As you can see from the header, this code is not to be edited manually. If anything needs to be modified, it must be done in the _schema.sql_ or _queries.sql_ files. You can also change the _sqlc.yaml_ configuration to tweak the code generation parameters.

## Using the Generated Code

The code generated by sqlc relies on the Go standard library SQL abstraction. It means we need to use the appropriate Go SQL driver to instantiate a connection to the database. The following file does just this:

```go file=postgres.go
package database

// ...

type Postgres struct {
	DB *sql.DB
}

func NewPostgres(host, user, password string) (*Postgres, error) {
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s user=%s password=%s sslmode=disable", host, user, password))
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &Postgres{DB: db}, nil
}
```

We can now instantiate our Postgres database:

```go file=main.go
package main

// ...

func main() {
	// Instantiates the database
	postgres, err := database.NewPostgres(/* credentials */)
	if err != nil {
		log.Fatal(err.Error())
	}
}
```

## What’s Next?

Now that we have completed our database implementation, we will have a look at [how to implement our REST API](/posts/modern-rest-api-with-go-and-postgresql-part-2/).
