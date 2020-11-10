const { ApolloServer, gql, UserInputError, AuthenticationError, PubSub } = require('apollo-server')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const pubsub = new PubSub()

let authors = [
  {
    name: 'Robert Martin',
    id: "afa51ab0-344d-11e9-a414-719c6709cf3e",
    born: 1952,
  },
  {
    name: 'Martin Fowler',
    id: "afa5b6f0-344d-11e9-a414-719c6709cf3e",
    born: 1963
  },
  {
    name: 'Fyodor Dostoevsky',
    id: "afa5b6f1-344d-11e9-a414-719c6709cf3e",
    born: 1821
  },
  { 
    name: 'Joshua Kerievsky', // birthyear not known
    id: "afa5b6f2-344d-11e9-a414-719c6709cf3e",
  },
  { 
    name: 'Sandi Metz', // birthyear not known
    id: "afa5b6f3-344d-11e9-a414-719c6709cf3e",
  },
]

/*
 * Saattaisi olla järkevämpää assosioida kirja ja sen tekijä tallettamalla kirjan yhteyteen tekijän nimen sijaan tekijän id
 * Yksinkertaisuuden vuoksi tallennamme kuitenkin kirjan yhteyteen tekijän nimen
*/

let books = [
  {
    title: 'Clean Code',
    published: 2008,
    author: 'Robert Martin',
    id: "afa5b6f4-344d-11e9-a414-719c6709cf3e",
    genres: ['refactoring']
  },
  {
    title: 'Agile software development',
    published: 2002,
    author: 'Robert Martin',
    id: "afa5b6f5-344d-11e9-a414-719c6709cf3e",
    genres: ['agile', 'patterns', 'design']
  },
  {
    title: 'Refactoring, edition 2',
    published: 2018,
    author: 'Martin Fowler',
    id: "afa5de00-344d-11e9-a414-719c6709cf3e",
    genres: ['refactoring']
  },
  {
    title: 'Refactoring to patterns',
    published: 2008,
    author: 'Joshua Kerievsky',
    id: "afa5de01-344d-11e9-a414-719c6709cf3e",
    genres: ['refactoring', 'patterns']
  },  
  {
    title: 'Practical Object-Oriented Design, An Agile Primer Using Ruby',
    published: 2012,
    author: 'Sandi Metz',
    id: "afa5de02-344d-11e9-a414-719c6709cf3e",
    genres: ['refactoring', 'design']
  },
  {
    title: 'Crime and punishment',
    published: 1866,
    author: 'Fyodor Dostoevsky',
    id: "afa5de03-344d-11e9-a414-719c6709cf3e",
    genres: ['classic', 'crime']
  },
  {
    title: 'The Demon ',
    published: 1872,
    author: 'Fyodor Dostoevsky',
    id: "afa5de04-344d-11e9-a414-719c6709cf3e",
    genres: ['classic', 'revolution']
  },
]
const MONGODB_URL = `mongodb+srv://fullstack:<password>@cluster0.ukmjg.mongodb.net/graphqlibrary?retryWrites=true&w=majority`
console.log('connecting to', MONGODB_URL)

mongoose.connect(MONGODB_URL, { useFindAndModify: true, useUnifiedTopology: true, useNewUrlParser: true, useCreateIndex: true})
  .then(() => console.log('connected to mongo db'))
  .catch((error) => console.log('error connecting to mongodb ',error.message))

const jwt = require('jsonwebtoken')

const JWT_SECRET = 'HALA MADRID'

const typeDefs = gql`
  type Book {
      title: String!
      published: Int!
      author: Author!
      id: ID!
      genres: [String!]!
  }

  type Author {
      name: String!
      born: Int
      bookCount: Int!
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Query {
      bookCount: Int!
      authorCount: Int!
      allBooks(author: String, genre: String): [Book!]!
      allAuthors: [Author!]!
      me: User
  }

  type Mutation {
      addBook(
        title: String!
        name: String!
        born: Int
        published: Int!
        genres: [String!]
      ): Book
      editAuthor(
        name: String!
        born: Int!
      ): Author
      createUser(
        username: String!
        favoriteGenre: String!
      ): User
      login(
        username: String!
        password: String!
      ): Token
  }
  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
        if((!args.author)&&(!args.genre)) {
          return await Book.find({}).populate('author')
        } 
        const books = await Book.find({}).populate('author')
        const booksByAuthor = books.filter(b => b.author.name === args.author)
        const booksByGenre = books.filter(b => b.genres.includes(args.genre))
        const booksByAuthorByGenre = booksByAuthor.filter(b => b.genres.includes(args.genre))
        if((args.author) && (args.genre)) {
          return booksByAuthorByGenre
        } else if(args.author) {
          return booksByAuthor
        } else if(args.genre) {
          return booksByGenre
        } 
    },
    allAuthors: async () => await Author.find({}),
    me: (root, args, context) => context.currentUser
  },
  Mutation: {
    addBook: async (root, args, context) => {

      const currentUser = context.currentUser
      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }
      const book = new Book({...args})
      const author = await Author.findOne({name: args.name})
      if(author) {
        author.bookCount = author.bookCount + 1
        author.save()
        book.author = author._id
      } else {
        const newAuthor = new Author ({
          name: args.name,
          born: args.born || null,
          bookCount: 1
        })
        await newAuthor.save().catch(error => {
          throw UserInputError(error.message)
        })
        book.author = newAuthor._id
      }
      await book.save().catch(error => {
        throw UserInputError(error.message)
      })
      const savedBook = await Book.findById(book._id).populate('author')
      pubsub.publish('BOOK_ADDED',{ bookAdded: savedBook })
      return savedBook
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }
      const authorToEdit = await Author.findOne({ name: args.name })
      if(!authorToEdit) {
        throw UserInputError(error.message, {
          invalidArgs: args
        })
      }
      authorToEdit.born =  args.born
      try {
        await authorToEdit.save()
      } catch(error) {
        throw UserInputError(error.message, {
          invalidArgs: args
        })
      }
      return authorToEdit
    },
    createUser: (root, args) => {
      const user = new User({ username: args.username, favoriteGenre: args.favoriteGenre })

      return  user.save().catch(error => {
        throw new UserInputError(error.message , {
          invalidArgs: args
        })
      })
    },
    login: async(root, args) => {
      const user = await User.findOne({ username: args.username })
      if(!user || args.password !== 'madrid') {
        throw new UserInputError('Wrong credentials')
      }
      const userForToken = {
        username: user.username,
        id: user._id
      }
      return { value: jwt.sign(userForToken, JWT_SECRET)}
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({req}) => {
    const auth = req ? req.headers.authorization : null
    if(auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(auth.substr(7), JWT_SECRET)
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }

  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscription ready at ${subscriptionsUrl}`)
})